/// iPay v2 - Simplified Payment Contract
/// 
/// State Machine (simplified):
/// deposit() -> PENDING_CLAIM -> claim() -> CONFIRMED
///                            -> revoke() -> REVOKED
///                            -> expire() -> EXPIRED
///
/// Key changes from v1:
/// - No CREATED state, deposit goes directly to PENDING_CLAIM
/// - No relayer spend() step needed
/// - Server manages claim_key encryption/decryption
/// - Global FrozenRegistry at @ipay for compliance/audit freeze
module ipay::pay_v2 {
    use std::error;
    use std::signer;
    use std::vector;
    use initia_std::block;
    use initia_std::event;
    use initia_std::hash;
    use initia_std::table::{Self, Table};
    use initia_std::object::{Self, Object, ExtendRef};
    use initia_std::fungible_asset::Metadata;
    use initia_std::primary_fungible_store;

    // ============================================
    // CONSTANTS
    // ============================================

    const STATUS_PENDING_CLAIM: u8 = 2;
    const STATUS_CONFIRMED: u8 = 3;
    const STATUS_REVOKED: u8 = 5;
    const STATUS_REFUNDED: u8 = 6;
    const STATUS_EXPIRED: u8 = 7;

    const E_NOT_INITIALIZED: u64 = 100;
    const E_ALREADY_INITIALIZED: u64 = 101;
    const E_INVALID_TRANSITION: u64 = 102;
    const E_PAYMENT_NOT_FOUND: u64 = 103;
    const E_NOT_AUTHORIZED: u64 = 104;
    const E_PAYMENT_EXPIRED: u64 = 105;
    const E_INVALID_KEY: u64 = 106;
    const E_INVALID_AMOUNT: u64 = 107;
    const E_NOT_SENDER: u64 = 111;
    const E_NOT_SPONSOR: u64 = 112;
    const E_ACCOUNT_FROZEN: u64 = 113;   // NEW: account is frozen

    const DEFAULT_CLAIM_TTL: u64 = 30 * 24 * 60 * 60;
    const MIN_AMOUNT: u64 = 10000;
    const MAX_AMOUNT: u64 = 100000000000;

    // ============================================
    // STRUCTS
    // ============================================

    /// Global freeze registry -- stored at @ipay (module deployer address)
    /// Admin (owner of @ipay) can freeze/unfreeze any address.
    /// Frozen addresses cannot send or receive payments.
    struct FrozenRegistry has key {
        frozen: Table<address, bool>,
    }

    /// Pool configuration and state
    struct PayPoolV2 has key {
        extend_ref: ExtendRef,
        iusd_fa: Object<Metadata>,
        owner: address,
        treasury: address,
        fee_bps: u64,
        fee_cap: u64,
        
        total_payments: u64,
        total_volume: u64,
        total_fees: u64,
        
        payments: Table<vector<u8>, PaymentV2>,
        user_payments: Table<address, vector<vector<u8>>>,
        claim_key_index: Table<vector<u8>, vector<u8>>,
        sponsors: Table<address, bool>,
    }

    /// Payment record
    struct PaymentV2 has store, drop, copy {
        id: vector<u8>,
        status: u8,
        amount: u64,
        fee: u64,
        sender: address,
        ciphertext: vector<u8>,
        key_for_sender: vector<u8>,
        key_for_recipient: vector<u8>,
        claim_key_hash: vector<u8>,
        claimed_by: address,
        created_at: u64,
        expires_at: u64,
    }

    // ============================================
    // EVENTS
    // ============================================

    #[event]
    struct PaymentCreatedEventV2 has drop, store {
        pool: address,
        payment_id: vector<u8>,
        sender: address,
        amount: u64,
        expires_at: u64,
    }

    #[event]
    struct PaymentClaimedEventV2 has drop, store {
        pool: address,
        payment_id: vector<u8>,
        claimed_by: address,
        amount: u64,
    }

    #[event]
    struct PaymentRevokedEventV2 has drop, store {
        pool: address,
        payment_id: vector<u8>,
        sender: address,
        amount: u64,
    }

    #[event]
    struct AddressFrozenEvent has drop, store {
        addr: address,
        frozen_by: address,
    }

    #[event]
    struct AddressUnfrozenEvent has drop, store {
        addr: address,
        unfrozen_by: address,
    }

    // ============================================
    // FREEZE REGISTRY (stored at @ipay)
    // ============================================

    /// Initialize the freeze registry -- must be called once by @ipay admin
    public entry fun init_freeze_registry(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @ipay, error::permission_denied(E_NOT_AUTHORIZED));
        assert!(!exists<FrozenRegistry>(@ipay), error::already_exists(E_ALREADY_INITIALIZED));
        move_to(admin, FrozenRegistry { frozen: table::new() });
    }

    /// Freeze an address -- prevents deposit and claim
    public entry fun freeze_address(
        admin: &signer,
        target: address,
    ) acquires FrozenRegistry {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @ipay, error::permission_denied(E_NOT_AUTHORIZED));
        assert!(exists<FrozenRegistry>(@ipay), error::not_found(E_NOT_INITIALIZED));
        let registry = borrow_global_mut<FrozenRegistry>(@ipay);
        if (!table::contains(&registry.frozen, target)) {
            table::add(&mut registry.frozen, target, true);
        } else {
            *table::borrow_mut(&mut registry.frozen, target) = true;
        };
        event::emit(AddressFrozenEvent { addr: target, frozen_by: admin_addr });
    }

    /// Unfreeze an address -- restores deposit and claim rights
    public entry fun unfreeze_address(
        admin: &signer,
        target: address,
    ) acquires FrozenRegistry {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @ipay, error::permission_denied(E_NOT_AUTHORIZED));
        assert!(exists<FrozenRegistry>(@ipay), error::not_found(E_NOT_INITIALIZED));
        let registry = borrow_global_mut<FrozenRegistry>(@ipay);
        if (table::contains(&registry.frozen, target)) {
            *table::borrow_mut(&mut registry.frozen, target) = false;
        };
        event::emit(AddressUnfrozenEvent { addr: target, unfrozen_by: admin_addr });
    }

    /// Internal: returns true if address is frozen (safe: returns false if registry not initialized)
    fun is_frozen_internal(addr: address): bool acquires FrozenRegistry {
        if (!exists<FrozenRegistry>(@ipay)) return false;
        let registry = borrow_global<FrozenRegistry>(@ipay);
        if (!table::contains(&registry.frozen, addr)) return false;
        *table::borrow(&registry.frozen, addr)
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    public fun create_pool(
        owner: &signer,
        iusd_fa: Object<Metadata>,
        fee_bps: u64,
        fee_cap: u64,
    ): Object<PayPoolV2> {
        let owner_addr = signer::address_of(owner);
        // Only the module deployer can create pools
        assert!(owner_addr == @ipay, error::permission_denied(E_NOT_AUTHORIZED));
        let constructor_ref = object::create_object(owner_addr, false);
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let object_signer = object::generate_signer(&constructor_ref);
        move_to(&object_signer, PayPoolV2 {
            extend_ref,
            iusd_fa,
            owner: owner_addr,
            treasury: owner_addr,
            fee_bps,
            fee_cap,
            total_payments: 0,
            total_volume: 0,
            total_fees: 0,
            payments: table::new(),
            user_payments: table::new(),
            claim_key_index: table::new(),
            sponsors: table::new(),
        });
        object::object_from_constructor_ref<PayPoolV2>(&constructor_ref)
    }

    // ============================================
    // CORE FUNCTIONS
    // ============================================

    public entry fun deposit(
        sender: &signer,
        pool: Object<PayPoolV2>,
        payment_id: vector<u8>,
        amount: u64,
        ciphertext: vector<u8>,
        key_for_sender: vector<u8>,
        key_for_recipient: vector<u8>,
        claim_key_hash: vector<u8>,
        ttl_seconds: u64,
    ) acquires PayPoolV2, FrozenRegistry {
        let sender_addr = signer::address_of(sender);

        //    Freeze check                                           
        assert!(!is_frozen_internal(sender_addr), error::permission_denied(E_ACCOUNT_FROZEN));

        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV2>(pool_addr);
        
        assert!(amount >= MIN_AMOUNT && amount <= MAX_AMOUNT, error::invalid_argument(E_INVALID_AMOUNT));
        assert!(!table::contains(&pool_data.payments, payment_id), error::already_exists(E_ALREADY_INITIALIZED));
        
        let fee = (amount * pool_data.fee_bps) / 10000;
        if (fee > pool_data.fee_cap) { fee = pool_data.fee_cap; };
        let net_amount = amount - fee;
        
        let pool_signer = object::generate_signer_for_extending(&pool_data.extend_ref);
        primary_fungible_store::transfer(sender, pool_data.iusd_fa, pool_addr, amount);
        if (fee > 0) {
            primary_fungible_store::transfer(&pool_signer, pool_data.iusd_fa, pool_data.treasury, fee);
        };
        
        let now = block::get_current_block_height();
        let ttl = if (ttl_seconds > 0) { ttl_seconds } else { DEFAULT_CLAIM_TTL };
        
        let payment = PaymentV2 {
            id: payment_id,
            status: STATUS_PENDING_CLAIM,
            amount: net_amount,
            fee,
            sender: sender_addr,
            ciphertext,
            key_for_sender,
            key_for_recipient,
            claim_key_hash,
            claimed_by: @0x0,
            created_at: now,
            expires_at: now + ttl,
        };
        
        table::add(&mut pool_data.payments, payment_id, payment);
        table::add(&mut pool_data.claim_key_index, claim_key_hash, payment_id);
        
        if (!table::contains(&pool_data.user_payments, sender_addr)) {
            table::add(&mut pool_data.user_payments, sender_addr, vector::empty());
        };
        let user_ids = table::borrow_mut(&mut pool_data.user_payments, sender_addr);
        vector::push_back(user_ids, payment_id);
        
        pool_data.total_payments = pool_data.total_payments + 1;
        pool_data.total_volume = pool_data.total_volume + amount;
        pool_data.total_fees = pool_data.total_fees + fee;
        
        event::emit(PaymentCreatedEventV2 {
            pool: pool_addr,
            payment_id,
            sender: sender_addr,
            amount: net_amount,
            expires_at: now + ttl,
        });
    }

    public entry fun claim(
        claimer: &signer,
        pool: Object<PayPoolV2>,
        payment_id: vector<u8>,
        claim_key: vector<u8>,
    ) acquires PayPoolV2, FrozenRegistry {
        let claimer_addr = signer::address_of(claimer);
        //    Freeze check                                          
        assert!(!is_frozen_internal(claimer_addr), error::permission_denied(E_ACCOUNT_FROZEN));
        claim_internal(pool, payment_id, claim_key, claimer_addr);
    }

    public entry fun sponsor_claim(
        sponsor: &signer,
        pool: Object<PayPoolV2>,
        payment_id: vector<u8>,
        claim_key: vector<u8>,
        recipient: address,
    ) acquires PayPoolV2, FrozenRegistry {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global<PayPoolV2>(pool_addr);
        let sponsor_addr = signer::address_of(sponsor);
        assert!(table::contains(&pool_data.sponsors, sponsor_addr), error::permission_denied(E_NOT_SPONSOR));
        //    Freeze check on recipient                              
        assert!(!is_frozen_internal(recipient), error::permission_denied(E_ACCOUNT_FROZEN));
        claim_internal(pool, payment_id, claim_key, recipient);
    }

    fun claim_internal(
        pool: Object<PayPoolV2>,
        payment_id: vector<u8>,
        claim_key: vector<u8>,
        recipient: address,
    ) acquires PayPoolV2 {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV2>(pool_addr);
        
        assert!(table::contains(&pool_data.payments, payment_id), error::not_found(E_PAYMENT_NOT_FOUND));
        let payment = table::borrow_mut(&mut pool_data.payments, payment_id);
        assert!(payment.status == STATUS_PENDING_CLAIM, error::invalid_state(E_INVALID_TRANSITION));
        
        let claim_key_hash = hash::sha2_256(claim_key);
        assert!(claim_key_hash == payment.claim_key_hash, error::permission_denied(E_INVALID_KEY));
        
        let now = block::get_current_block_height();
        assert!(now <= payment.expires_at, error::invalid_state(E_PAYMENT_EXPIRED));
        
        let pool_signer = object::generate_signer_for_extending(&pool_data.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool_data.iusd_fa, recipient, payment.amount);
        
        payment.status = STATUS_CONFIRMED;
        payment.claimed_by = recipient;
        
        event::emit(PaymentClaimedEventV2 {
            pool: pool_addr,
            payment_id,
            claimed_by: recipient,
            amount: payment.amount,
        });
    }

    public entry fun revoke(
        sender: &signer,
        pool: Object<PayPoolV2>,
        payment_id: vector<u8>,
    ) acquires PayPoolV2 {
        let sender_addr = signer::address_of(sender);
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV2>(pool_addr);
        
        assert!(table::contains(&pool_data.payments, payment_id), error::not_found(E_PAYMENT_NOT_FOUND));
        let payment = table::borrow_mut(&mut pool_data.payments, payment_id);
        assert!(payment.sender == sender_addr, error::permission_denied(E_NOT_SENDER));
        assert!(payment.status == STATUS_PENDING_CLAIM, error::invalid_state(E_INVALID_TRANSITION));
        
        let pool_signer = object::generate_signer_for_extending(&pool_data.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool_data.iusd_fa, sender_addr, payment.amount);
        payment.status = STATUS_REVOKED;
        
        event::emit(PaymentRevokedEventV2 {
            pool: pool_addr,
            payment_id,
            sender: sender_addr,
            amount: payment.amount,
        });
    }

    public entry fun refund(
        recipient: &signer,
        pool: Object<PayPoolV2>,
        payment_id: vector<u8>,
    ) acquires PayPoolV2 {
        let recipient_addr = signer::address_of(recipient);
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV2>(pool_addr);
        
        assert!(table::contains(&pool_data.payments, payment_id), error::not_found(E_PAYMENT_NOT_FOUND));
        let payment = table::borrow_mut(&mut pool_data.payments, payment_id);
        assert!(payment.claimed_by == recipient_addr, error::permission_denied(E_NOT_AUTHORIZED));
        assert!(payment.status == STATUS_CONFIRMED, error::invalid_state(E_INVALID_TRANSITION));
        
        primary_fungible_store::transfer(recipient, pool_data.iusd_fa, payment.sender, payment.amount);
        payment.status = STATUS_REFUNDED;
    }

    public entry fun expire(
        _caller: &signer,
        pool: Object<PayPoolV2>,
        payment_id: vector<u8>,
    ) acquires PayPoolV2 {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV2>(pool_addr);
        
        assert!(table::contains(&pool_data.payments, payment_id), error::not_found(E_PAYMENT_NOT_FOUND));
        let payment = table::borrow_mut(&mut pool_data.payments, payment_id);
        assert!(payment.status == STATUS_PENDING_CLAIM, error::invalid_state(E_INVALID_TRANSITION));
        
        let now = block::get_current_block_height();
        assert!(now > payment.expires_at, error::invalid_state(E_PAYMENT_EXPIRED));
        
        let pool_signer = object::generate_signer_for_extending(&pool_data.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool_data.iusd_fa, payment.sender, payment.amount);
        payment.status = STATUS_EXPIRED;
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    public entry fun add_sponsor(
        owner: &signer,
        pool: Object<PayPoolV2>,
        sponsor: address,
    ) acquires PayPoolV2 {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV2>(pool_addr);
        assert!(signer::address_of(owner) == pool_data.owner, error::permission_denied(E_NOT_AUTHORIZED));
        if (!table::contains(&pool_data.sponsors, sponsor)) {
            table::add(&mut pool_data.sponsors, sponsor, true);
        };
    }

    public entry fun remove_sponsor(
        owner: &signer,
        pool: Object<PayPoolV2>,
        sponsor: address,
    ) acquires PayPoolV2 {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV2>(pool_addr);
        assert!(signer::address_of(owner) == pool_data.owner, error::permission_denied(E_NOT_AUTHORIZED));
        if (table::contains(&pool_data.sponsors, sponsor)) {
            table::remove(&mut pool_data.sponsors, sponsor);
        };
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    #[view]
    public fun is_frozen(addr: address): bool acquires FrozenRegistry {
        is_frozen_internal(addr)
    }

    #[view]
    public fun get_payment(pool: Object<PayPoolV2>, payment_id: vector<u8>): (u8, u64, address, u64, u64) acquires PayPoolV2 {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global<PayPoolV2>(pool_addr);
        if (!table::contains(&pool_data.payments, payment_id)) {
            return (0, 0, @0x0, 0, 0)
        };
        let payment = table::borrow(&pool_data.payments, payment_id);
        (payment.status, payment.amount, payment.sender, payment.created_at, payment.expires_at)
    }

    #[view]
    public fun get_payment_full(pool: Object<PayPoolV2>, payment_id: vector<u8>): (
        u8, u64, u64, address, address, u64, u64, vector<u8>, vector<u8>, vector<u8>, vector<u8>,
    ) acquires PayPoolV2 {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global<PayPoolV2>(pool_addr);
        if (!table::contains(&pool_data.payments, payment_id)) {
            return (0, 0, 0, @0x0, @0x0, 0, 0, vector::empty(), vector::empty(), vector::empty(), vector::empty())
        };
        let payment = table::borrow(&pool_data.payments, payment_id);
        (
            payment.status, payment.amount, payment.fee, payment.sender, payment.claimed_by,
            payment.created_at, payment.expires_at,
            payment.ciphertext, payment.key_for_sender, payment.key_for_recipient, payment.claim_key_hash,
        )
    }

    #[view]
    public fun get_pool_stats(pool: Object<PayPoolV2>): (u64, u64, u64) acquires PayPoolV2 {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global<PayPoolV2>(pool_addr);
        (pool_data.total_payments, pool_data.total_volume, pool_data.total_fees)
    }

    #[view]
    public fun is_sponsor(pool: Object<PayPoolV2>, addr: address): bool acquires PayPoolV2 {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global<PayPoolV2>(pool_addr);
        table::contains(&pool_data.sponsors, addr)
    }
}
