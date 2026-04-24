/// iPay v3 - Payment Contract
///
/// State Machine:
///   deposit() -> PENDING_CLAIM -> claim()   -> CONFIRMED
///                              -> revoke()  -> REVOKED   (sender cancels)
///                              -> expire()  -> EXPIRED   (anyone, after TTL)
///                              -> refund()  -> REFUNDED  (recipient returns)
///
/// Security fixes from v2:
///   - create_pool restricted to @ipay (deployer only)
///   - revoke() verifies sender == payment.sender
///   - FrozenRegistry for compliance freeze/unfreeze
///   - No oracle dependency
module ipay::pay_v3 {
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

    // ====================================================================
    // CONSTANTS
    // ====================================================================

    const STATUS_PENDING_CLAIM: u8 = 2;
    const STATUS_CONFIRMED: u8 = 3;
    const STATUS_REVOKED: u8 = 5;
    const STATUS_REFUNDED: u8 = 6;
    const STATUS_EXPIRED: u8 = 7;

    const E_NOT_INITIALIZED: u64 = 200;
    const E_ALREADY_INITIALIZED: u64 = 201;
    const E_INVALID_TRANSITION: u64 = 202;
    const E_PAYMENT_NOT_FOUND: u64 = 203;
    const E_NOT_AUTHORIZED: u64 = 204;
    const E_PAYMENT_EXPIRED: u64 = 205;
    const E_INVALID_KEY: u64 = 206;
    const E_INVALID_AMOUNT: u64 = 207;
    const E_NOT_SENDER: u64 = 211;
    const E_NOT_SPONSOR: u64 = 212;
    const E_ACCOUNT_FROZEN: u64 = 213;

    const DEFAULT_CLAIM_TTL: u64 = 30 * 24 * 60 * 60;   // 30 days
    const MIN_AMOUNT: u64 = 100_000;                      // 0.1 iUSD
    const MAX_AMOUNT: u64 = 100_000_000_000;              // 100K iUSD

    // ====================================================================
    // STRUCTS
    // ====================================================================

    // Global freeze registry -- stored at @ipay
    struct FrozenRegistry has key {
        frozen: Table<address, bool>,
        admins: Table<address, bool>,  // multi-admin for freeze/unfreeze
    }

    // Pool configuration and state
    struct PayPoolV3 has key {
        extend_ref: ExtendRef,
        iusd_fa: Object<Metadata>,
        owner: address,               // original creator (always an owner)
        owners: Table<address, bool>,  // multi-owner registry
        treasury: address,
        fee_bps: u64,
        fee_cap: u64,

        total_payments: u64,
        total_volume: u64,
        total_fees: u64,

        payments: Table<vector<u8>, PaymentV3>,
        user_payments: Table<address, vector<vector<u8>>>,
        claim_key_index: Table<vector<u8>, vector<u8>>,
        sponsors: Table<address, bool>,
    }

    // Payment record
    struct PaymentV3 has store, drop, copy {
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

    // ====================================================================
    // EVENTS
    // ====================================================================

    #[event]
    struct PaymentCreatedEvent has drop, store {
        pool: address,
        payment_id: vector<u8>,
        sender: address,
        amount: u64,
        expires_at: u64,
    }

    #[event]
    struct PaymentClaimedEvent has drop, store {
        pool: address,
        payment_id: vector<u8>,
        claimed_by: address,
        amount: u64,
    }

    #[event]
    struct PaymentRevokedEvent has drop, store {
        pool: address,
        payment_id: vector<u8>,
        sender: address,
        amount: u64,
    }

    #[event]
    struct PaymentExpiredEvent has drop, store {
        pool: address,
        payment_id: vector<u8>,
        sender: address,
        amount: u64,
    }

    #[event]
    struct OwnerAddedEvent has drop, store {
        pool: address, new_owner: address, added_by: address,
    }

    #[event]
    struct OwnerRemovedEvent has drop, store {
        pool: address, removed_owner: address, removed_by: address,
    }

    #[event]
    struct EmergencyWithdrawEvent has drop, store {
        pool: address, to: address, amount: u64, withdrawn_by: address,
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

    // ====================================================================
    // FREEZE REGISTRY (multi-admin)
    // ====================================================================

    public entry fun init_freeze_registry(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @ipay, error::permission_denied(E_NOT_AUTHORIZED));
        assert!(!exists<FrozenRegistry>(@ipay), error::already_exists(E_ALREADY_INITIALIZED));
        let admins = table::new();
        table::add(&mut admins, admin_addr, true);
        move_to(admin, FrozenRegistry { frozen: table::new(), admins });
    }

    // Assert caller is a freeze admin
    fun assert_freeze_admin(caller: address) acquires FrozenRegistry {
        assert!(exists<FrozenRegistry>(@ipay), error::not_found(E_NOT_INITIALIZED));
        let registry = borrow_global<FrozenRegistry>(@ipay);
        assert!(
            caller == @ipay || (table::contains(&registry.admins, caller) && *table::borrow(&registry.admins, caller)),
            error::permission_denied(E_NOT_AUTHORIZED)
        );
    }

    public entry fun add_freeze_admin(admin: &signer, new_admin: address) acquires FrozenRegistry {
        let admin_addr = signer::address_of(admin);
        assert_freeze_admin(admin_addr);
        let registry = borrow_global_mut<FrozenRegistry>(@ipay);
        if (!table::contains(&registry.admins, new_admin)) {
            table::add(&mut registry.admins, new_admin, true);
        } else {
            *table::borrow_mut(&mut registry.admins, new_admin) = true;
        };
    }

    public entry fun remove_freeze_admin(admin: &signer, target: address) acquires FrozenRegistry {
        let admin_addr = signer::address_of(admin);
        assert_freeze_admin(admin_addr);
        // Cannot remove @ipay (original deployer)
        assert!(target != @ipay, error::permission_denied(E_NOT_AUTHORIZED));
        let registry = borrow_global_mut<FrozenRegistry>(@ipay);
        if (table::contains(&registry.admins, target)) {
            *table::borrow_mut(&mut registry.admins, target) = false;
        };
    }

    public entry fun freeze_address(admin: &signer, target: address) acquires FrozenRegistry {
        let admin_addr = signer::address_of(admin);
        assert_freeze_admin(admin_addr);
        let registry = borrow_global_mut<FrozenRegistry>(@ipay);
        if (!table::contains(&registry.frozen, target)) {
            table::add(&mut registry.frozen, target, true);
        } else {
            *table::borrow_mut(&mut registry.frozen, target) = true;
        };
        event::emit(AddressFrozenEvent { addr: target, frozen_by: admin_addr });
    }

    public entry fun unfreeze_address(admin: &signer, target: address) acquires FrozenRegistry {
        let admin_addr = signer::address_of(admin);
        assert_freeze_admin(admin_addr);
        let registry = borrow_global_mut<FrozenRegistry>(@ipay);
        if (table::contains(&registry.frozen, target)) {
            *table::borrow_mut(&mut registry.frozen, target) = false;
        };
        event::emit(AddressUnfrozenEvent { addr: target, unfrozen_by: admin_addr });
    }

    fun is_frozen_internal(addr: address): bool acquires FrozenRegistry {
        if (!exists<FrozenRegistry>(@ipay)) return false;
        let registry = borrow_global<FrozenRegistry>(@ipay);
        if (!table::contains(&registry.frozen, addr)) return false;
        *table::borrow(&registry.frozen, addr)
    }

    #[view]
    public fun is_freeze_admin(addr: address): bool acquires FrozenRegistry {
        if (!exists<FrozenRegistry>(@ipay)) return false;
        let registry = borrow_global<FrozenRegistry>(@ipay);
        addr == @ipay || (table::contains(&registry.admins, addr) && *table::borrow(&registry.admins, addr))
    }

    // ====================================================================
    // POOL CREATION (@ipay only)
    // ====================================================================

    /// Entry point for creating a pool via CLI
    public entry fun init_pool(
        owner: &signer,
        iusd_fa: Object<Metadata>,
        fee_bps: u64,
        fee_cap: u64,
    ) {
        create_pool(owner, iusd_fa, fee_bps, fee_cap);
    }

    public fun create_pool(
        owner: &signer,
        iusd_fa: Object<Metadata>,
        fee_bps: u64,
        fee_cap: u64,
    ): Object<PayPoolV3> {
        let owner_addr = signer::address_of(owner);
        assert!(owner_addr == @ipay, error::permission_denied(E_NOT_AUTHORIZED));

        let constructor_ref = object::create_object(owner_addr, false);
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let object_signer = object::generate_signer(&constructor_ref);
        let owners = table::new();
        table::add(&mut owners, owner_addr, true);

        move_to(&object_signer, PayPoolV3 {
            extend_ref,
            iusd_fa,
            owner: owner_addr,
            owners,
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
        object::object_from_constructor_ref<PayPoolV3>(&constructor_ref)
    }

    // ====================================================================
    // CORE: DEPOSIT
    // ====================================================================

    public entry fun deposit(
        sender: &signer,
        pool: Object<PayPoolV3>,
        payment_id: vector<u8>,
        amount: u64,
        ciphertext: vector<u8>,
        key_for_sender: vector<u8>,
        key_for_recipient: vector<u8>,
        claim_key_hash: vector<u8>,
        ttl_seconds: u64,
    ) acquires PayPoolV3, FrozenRegistry {
        let sender_addr = signer::address_of(sender);
        assert!(!is_frozen_internal(sender_addr), error::permission_denied(E_ACCOUNT_FROZEN));

        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV3>(pool_addr);

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

        let payment = PaymentV3 {
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

        event::emit(PaymentCreatedEvent {
            pool: pool_addr, payment_id, sender: sender_addr,
            amount: net_amount, expires_at: now + ttl,
        });
    }

    // ====================================================================
    // CORE: CLAIM
    // ====================================================================

    public entry fun claim(
        claimer: &signer,
        pool: Object<PayPoolV3>,
        payment_id: vector<u8>,
        claim_key: vector<u8>,
    ) acquires PayPoolV3, FrozenRegistry {
        let claimer_addr = signer::address_of(claimer);
        assert!(!is_frozen_internal(claimer_addr), error::permission_denied(E_ACCOUNT_FROZEN));
        claim_internal(pool, payment_id, claim_key, claimer_addr);
    }

    public entry fun sponsor_claim(
        sponsor: &signer,
        pool: Object<PayPoolV3>,
        payment_id: vector<u8>,
        claim_key: vector<u8>,
        recipient: address,
    ) acquires PayPoolV3, FrozenRegistry {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global<PayPoolV3>(pool_addr);
        let sponsor_addr = signer::address_of(sponsor);
        assert!(table::contains(&pool_data.sponsors, sponsor_addr), error::permission_denied(E_NOT_SPONSOR));
        assert!(!is_frozen_internal(recipient), error::permission_denied(E_ACCOUNT_FROZEN));
        claim_internal(pool, payment_id, claim_key, recipient);
    }

    fun claim_internal(
        pool: Object<PayPoolV3>,
        payment_id: vector<u8>,
        claim_key: vector<u8>,
        recipient: address,
    ) acquires PayPoolV3 {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV3>(pool_addr);

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

        event::emit(PaymentClaimedEvent {
            pool: pool_addr, payment_id, claimed_by: recipient, amount: payment.amount,
        });
    }

    // ====================================================================
    // CORE: REVOKE (sender only)
    // ====================================================================

    public entry fun revoke(
        sender: &signer,
        pool: Object<PayPoolV3>,
        payment_id: vector<u8>,
    ) acquires PayPoolV3 {
        let sender_addr = signer::address_of(sender);
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV3>(pool_addr);

        assert!(table::contains(&pool_data.payments, payment_id), error::not_found(E_PAYMENT_NOT_FOUND));
        let payment = table::borrow_mut(&mut pool_data.payments, payment_id);
        assert!(payment.sender == sender_addr, error::permission_denied(E_NOT_SENDER));
        assert!(payment.status == STATUS_PENDING_CLAIM, error::invalid_state(E_INVALID_TRANSITION));

        let pool_signer = object::generate_signer_for_extending(&pool_data.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool_data.iusd_fa, sender_addr, payment.amount);
        payment.status = STATUS_REVOKED;

        event::emit(PaymentRevokedEvent {
            pool: pool_addr, payment_id, sender: sender_addr, amount: payment.amount,
        });
    }

    // ====================================================================
    // CORE: REFUND (claimed recipient returns funds to sender)
    // ====================================================================

    public entry fun refund(
        recipient: &signer,
        pool: Object<PayPoolV3>,
        payment_id: vector<u8>,
    ) acquires PayPoolV3 {
        let recipient_addr = signer::address_of(recipient);
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV3>(pool_addr);

        assert!(table::contains(&pool_data.payments, payment_id), error::not_found(E_PAYMENT_NOT_FOUND));
        let payment = table::borrow_mut(&mut pool_data.payments, payment_id);
        assert!(payment.claimed_by == recipient_addr, error::permission_denied(E_NOT_AUTHORIZED));
        assert!(payment.status == STATUS_CONFIRMED, error::invalid_state(E_INVALID_TRANSITION));

        primary_fungible_store::transfer(recipient, pool_data.iusd_fa, payment.sender, payment.amount);
        payment.status = STATUS_REFUNDED;
    }

    // ====================================================================
    // CORE: EXPIRE (anyone can trigger after TTL)
    // ====================================================================

    public entry fun expire(
        _caller: &signer,
        pool: Object<PayPoolV3>,
        payment_id: vector<u8>,
    ) acquires PayPoolV3 {
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global_mut<PayPoolV3>(pool_addr);

        assert!(table::contains(&pool_data.payments, payment_id), error::not_found(E_PAYMENT_NOT_FOUND));
        let payment = table::borrow_mut(&mut pool_data.payments, payment_id);
        assert!(payment.status == STATUS_PENDING_CLAIM, error::invalid_state(E_INVALID_TRANSITION));

        let now = block::get_current_block_height();
        assert!(now > payment.expires_at, error::invalid_state(E_PAYMENT_EXPIRED));

        let pool_signer = object::generate_signer_for_extending(&pool_data.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool_data.iusd_fa, payment.sender, payment.amount);
        payment.status = STATUS_EXPIRED;

        event::emit(PaymentExpiredEvent {
            pool: pool_addr, payment_id, sender: payment.sender, amount: payment.amount,
        });
    }

    // ====================================================================
    // ADMIN FUNCTIONS
    // ====================================================================

    // ------------------------------------------------------------------
    // OWNER MANAGEMENT
    // ------------------------------------------------------------------

    fun assert_pool_owner(pool: Object<PayPoolV3>, caller: address) acquires PayPoolV3 {
        let d = borrow_global<PayPoolV3>(object::object_address(&pool));
        assert!(
            caller == d.owner || (table::contains(&d.owners, caller) && *table::borrow(&d.owners, caller)),
            error::permission_denied(E_NOT_AUTHORIZED)
        );
    }

    public entry fun add_owner(
        admin: &signer, pool: Object<PayPoolV3>, new_owner: address,
    ) acquires PayPoolV3 {
        let admin_addr = signer::address_of(admin);
        assert_pool_owner(pool, admin_addr);
        let pool_data = borrow_global_mut<PayPoolV3>(object::object_address(&pool));
        if (!table::contains(&pool_data.owners, new_owner)) {
            table::add(&mut pool_data.owners, new_owner, true);
        } else {
            *table::borrow_mut(&mut pool_data.owners, new_owner) = true;
        };
        event::emit(OwnerAddedEvent {
            pool: object::object_address(&pool), new_owner, added_by: admin_addr,
        });
    }

    public entry fun remove_owner(
        admin: &signer, pool: Object<PayPoolV3>, target_owner: address,
    ) acquires PayPoolV3 {
        let admin_addr = signer::address_of(admin);
        assert_pool_owner(pool, admin_addr);
        let pool_data = borrow_global_mut<PayPoolV3>(object::object_address(&pool));
        // Cannot remove the original creator
        assert!(target_owner != pool_data.owner, error::permission_denied(E_NOT_AUTHORIZED));
        if (table::contains(&pool_data.owners, target_owner)) {
            *table::borrow_mut(&mut pool_data.owners, target_owner) = false;
        };
        event::emit(OwnerRemovedEvent {
            pool: object::object_address(&pool), removed_owner: target_owner, removed_by: admin_addr,
        });
    }

    // ------------------------------------------------------------------
    // EMERGENCY WITHDRAW
    // ------------------------------------------------------------------

    /// Emergency withdraw funds stuck in the pool to a target address.
    /// Only owners can call. Use when bugs trap funds in the contract.
    public entry fun emergency_withdraw(
        admin: &signer,
        pool: Object<PayPoolV3>,
        to: address,
        amount: u64,
    ) acquires PayPoolV3 {
        let admin_addr = signer::address_of(admin);
        assert_pool_owner(pool, admin_addr);
        let pool_addr = object::object_address(&pool);
        let pool_data = borrow_global<PayPoolV3>(pool_addr);
        let pool_signer = object::generate_signer_for_extending(&pool_data.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool_data.iusd_fa, to, amount);
        event::emit(EmergencyWithdrawEvent {
            pool: pool_addr, to, amount, withdrawn_by: admin_addr,
        });
    }

    // ------------------------------------------------------------------
    // ADMIN CONFIG
    // ------------------------------------------------------------------

    public entry fun add_sponsor(
        owner: &signer, pool: Object<PayPoolV3>, sponsor: address,
    ) acquires PayPoolV3 {
        assert_pool_owner(pool, signer::address_of(owner));
        let pool_data = borrow_global_mut<PayPoolV3>(object::object_address(&pool));
        if (!table::contains(&pool_data.sponsors, sponsor)) {
            table::add(&mut pool_data.sponsors, sponsor, true);
        };
    }

    public entry fun remove_sponsor(
        owner: &signer, pool: Object<PayPoolV3>, sponsor: address,
    ) acquires PayPoolV3 {
        assert_pool_owner(pool, signer::address_of(owner));
        let pool_data = borrow_global_mut<PayPoolV3>(object::object_address(&pool));
        if (table::contains(&pool_data.sponsors, sponsor)) {
            table::remove(&mut pool_data.sponsors, sponsor);
        };
    }

    public entry fun set_treasury(
        owner: &signer, pool: Object<PayPoolV3>, new_treasury: address,
    ) acquires PayPoolV3 {
        assert_pool_owner(pool, signer::address_of(owner));
        let pool_data = borrow_global_mut<PayPoolV3>(object::object_address(&pool));
        pool_data.treasury = new_treasury;
    }

    public entry fun set_fee(
        owner: &signer, pool: Object<PayPoolV3>, fee_bps: u64, fee_cap: u64,
    ) acquires PayPoolV3 {
        assert_pool_owner(pool, signer::address_of(owner));
        let pool_data = borrow_global_mut<PayPoolV3>(object::object_address(&pool));
        assert!(fee_bps <= 1000, error::invalid_argument(E_INVALID_AMOUNT)); // max 10%
        pool_data.fee_bps = fee_bps;
        pool_data.fee_cap = fee_cap;
    }

    // ====================================================================
    // VIEW FUNCTIONS
    // ====================================================================

    #[view]
    public fun is_frozen(addr: address): bool acquires FrozenRegistry {
        is_frozen_internal(addr)
    }

    #[view]
    public fun get_payment(
        pool: Object<PayPoolV3>, payment_id: vector<u8>,
    ): (u8, u64, address, u64, u64) acquires PayPoolV3 {
        let pool_data = borrow_global<PayPoolV3>(object::object_address(&pool));
        if (!table::contains(&pool_data.payments, payment_id)) {
            return (0, 0, @0x0, 0, 0)
        };
        let p = table::borrow(&pool_data.payments, payment_id);
        (p.status, p.amount, p.sender, p.created_at, p.expires_at)
    }

    #[view]
    public fun get_payment_full(
        pool: Object<PayPoolV3>, payment_id: vector<u8>,
    ): (u8, u64, u64, address, address, u64, u64,
        vector<u8>, vector<u8>, vector<u8>, vector<u8>,
    ) acquires PayPoolV3 {
        let pool_data = borrow_global<PayPoolV3>(object::object_address(&pool));
        if (!table::contains(&pool_data.payments, payment_id)) {
            return (0, 0, 0, @0x0, @0x0, 0, 0,
                    vector::empty(), vector::empty(), vector::empty(), vector::empty())
        };
        let p = table::borrow(&pool_data.payments, payment_id);
        (p.status, p.amount, p.fee, p.sender, p.claimed_by,
         p.created_at, p.expires_at,
         p.ciphertext, p.key_for_sender, p.key_for_recipient, p.claim_key_hash)
    }

    #[view]
    public fun get_pool_stats(
        pool: Object<PayPoolV3>,
    ): (u64, u64, u64) acquires PayPoolV3 {
        let pool_data = borrow_global<PayPoolV3>(object::object_address(&pool));
        (pool_data.total_payments, pool_data.total_volume, pool_data.total_fees)
    }

    #[view]
    public fun get_pool_config(
        pool: Object<PayPoolV3>,
    ): (address, address, u64, u64) acquires PayPoolV3 {
        let pool_data = borrow_global<PayPoolV3>(object::object_address(&pool));
        (pool_data.owner, pool_data.treasury, pool_data.fee_bps, pool_data.fee_cap)
    }

    #[view]
    public fun is_owner(
        pool: Object<PayPoolV3>, addr: address,
    ): bool acquires PayPoolV3 {
        let d = borrow_global<PayPoolV3>(object::object_address(&pool));
        addr == d.owner || (table::contains(&d.owners, addr) && *table::borrow(&d.owners, addr))
    }

    #[view]
    public fun is_sponsor(
        pool: Object<PayPoolV3>, addr: address,
    ): bool acquires PayPoolV3 {
        let pool_data = borrow_global<PayPoolV3>(object::object_address(&pool));
        table::contains(&pool_data.sponsors, addr)
    }
}
