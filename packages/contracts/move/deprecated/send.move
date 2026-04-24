/// iPay Send Order Contract
/// 
/// State Machine:
/// S0 created -> S1 processing -> S2 pending_claim -> S3 confirmed
///                                              -> S4 rejected  
///                                              -> S5 revoked
///                                              -> S7 expired
/// S3 confirmed -> S6 refunded
/// Any -> S8 intervened (admin only)
///
/// All sensitive data is encrypted off-chain. Contract stores:
/// - ciphertext (encrypted payload)
/// - key_for_sender, key_for_recipient (ECIES encrypted random key)
/// - key_for_admin (ECIES encrypted random key)
module ipay::send {
    use std::error;
    use std::signer;
    use std::vector;
    use std::option::{Self, Option};
    use initia_std::block;
    use initia_std::event;
    use initia_std::hash;
    use initia_std::table::{Self, Table};
    use initia_std::object::{Self, Object, ExtendRef};
    use initia_std::fungible_asset::Metadata;
    use initia_std::primary_fungible_store;

    use ipay::order_common;

    // ============================================
    // CONSTANTS
    // ============================================

    const ORDER_TYPE: u8 = 1; // ORDER_TYPE_SEND

    // Status codes (local aliases)
    const STATUS_CREATED: u8 = 0;
    const STATUS_PROCESSING: u8 = 1;
    const STATUS_PENDING_CLAIM: u8 = 2;
    const STATUS_CONFIRMED: u8 = 3;
    const STATUS_REJECTED: u8 = 4;
    const STATUS_REVOKED: u8 = 5;
    const STATUS_REFUNDED: u8 = 6;
    const STATUS_EXPIRED: u8 = 7;
    const STATUS_PENDING_REGISTER: u8 = 8;
    const STATUS_INTERVENED: u8 = 99;

    // Action codes
    const ACTION_DEPOSIT: u8 = 1;
    const ACTION_SPEND: u8 = 2;
    const ACTION_CLAIM: u8 = 3;
    const ACTION_REJECT: u8 = 4;
    const ACTION_REVOKE: u8 = 5;
    const ACTION_REFUND: u8 = 6;
    const ACTION_EXPIRE: u8 = 7;
    const ACTION_WITHDRAW_NOTE: u8 = 8;
    const ACTION_INTERVENE: u8 = 9;
    const ACTION_AUTO_CLAIM: u8 = 10;
    const ACTION_ACTIVATE: u8 = 11;

    // Error codes
    const E_NOT_INITIALIZED: u64 = 100;
    const E_ALREADY_INITIALIZED: u64 = 101;
    const E_INVALID_TRANSITION: u64 = 102;
    const E_ORDER_NOT_FOUND: u64 = 103;
    const E_NOT_AUTHORIZED: u64 = 104;
    const E_ORDER_EXPIRED: u64 = 105;
    const E_INVALID_KEY: u64 = 106;
    const E_INVALID_AMOUNT: u64 = 107;
    const E_NULLIFIER_USED: u64 = 108;

    // Viewing pubkey signature types
    const VIEWING_PUBKEY_TYPE_UNKNOWN: u8 = 0;
    const VIEWING_PUBKEY_TYPE_EIP191: u8 = 1;
    const VIEWING_PUBKEY_TYPE_ADR036: u8 = 2;
    const E_NOT_RELAYER: u64 = 109;
    const E_NOT_RECIPIENT: u64 = 110;
    const E_NOT_SENDER: u64 = 111;
    const E_BACKUP_EXISTS: u64 = 112;

    // Config
    const DEFAULT_CLAIM_TTL: u64 = 30 * 24 * 60 * 60; // 30 days in seconds
    const MIN_AMOUNT: u64 = 10000;   // 0.01 iUSD
    const MAX_AMOUNT: u64 = 100000000000; // 100,000 iUSD

    // ============================================
    // STRUCTS
    // ============================================

    /// Pool configuration and state
    struct SendPool has key {
        extend_ref: ExtendRef,
        iusd_fa: Object<Metadata>,
        owner: address,
        treasury: address,
        fee_bps: u64,
        fee_cap: u64,  // Max fee in micro units (e.g., 5_000_000 = 5 iUSD)
        admin_pubkey: vector<u8>,  // For encryption
        
        // Merkle tree state
        merkle_root: vector<u8>,
        tree_size: u64,
        
        // Stats
        total_orders: u64,
        total_volume: u64,
        total_fees: u64,
        
        // Tables
        orders: Table<vector<u8>, SendOrder>,           // id -> order
        nullifiers: Table<vector<u8>, bool>,            // nullifier -> spent
        user_orders: Table<address, vector<vector<u8>>>, // user -> ids
        cooked_index: Table<vector<u8>, vector<vector<u8>>>, // cooked_addr -> ids
        claim_key_index: Table<vector<u8>, vector<u8>>,  // claim_key_hash -> id
        refund_key_index: Table<vector<u8>, vector<u8>>, // refund_key_hash -> id
        
        // Access control
        relayers: Table<address, bool>,                 // authorized relayers
        
        // Pending orders (for Relayer to process)
        pending_orders: vector<vector<u8>>,             // ids with STATUS_CREATED
    }

    /// Send order (encrypted)
    struct SendOrder has store, drop, copy {
        id: vector<u8>,
        status: u8,
        created_at: u64,
        expires_at: u64,
        
        // Encrypted data (off-chain encryption)
        ciphertext: vector<u8>,       // AES(random_key, {amount, memo, sender, recipient})
        key_for_sender: vector<u8>,   // ECIES(sender_pubkey, random_key)
        key_for_recipient: vector<u8>, // ECIES(recipient_pubkey, random_key)
        key_for_admin: vector<u8>,    // ECIES(admin_pubkey, random_key)
        
        // Indexing
        sender_cooked: vector<u8>,    // For sender's inbox
        recipient_cooked: vector<u8>, // For recipient's inbox
        
        // Claim data
        claim_key_hash: vector<u8>,   // SHA256(claim_key) - for recipient to claim
        refund_key_hash: vector<u8>,  // SHA256(refund_key) - for sender to revoke/refund
        
        // Amount stored for pool accounting (not exposed in view)
        amount: u64,
        
        // Claim tracking (set when claimed)
        claimed_by: address,          // Address that claimed - for refund verification
        claimed_at: u64,
    }

    /// User settings
    struct UserSettings has key, store {
        auto_claim: bool,
        viewing_pubkey: vector<u8>,
        viewing_pubkey_type: u8,  // 0=Unknown, 1=EIP-191, 2=ADR-036
    }

    /// Sponsored viewing keys for users without gas (stored at @ipay)
    struct SponsoredViewingKeys has key {
        keys: Table<address, SponsoredKey>,
    }

    struct SponsoredKey has store, drop, copy {
        viewing_pubkey: vector<u8>,
        viewing_pubkey_type: u8,
    }

    /// Viewing key backup (encrypted, stored on-chain)
    /// Can only be set once to prevent accidental overwrites
    struct ViewingKeyBackup has store, drop, copy {
        encrypted_key: vector<u8>,  // Encrypted viewing private key
        sign_type: u8,              // 1=EIP-191, 2=ADR-036
        created_at: u64,
    }

    /// Global storage for viewing key backups
    struct ViewingKeyBackups has key {
        backups: Table<address, ViewingKeyBackup>,
    }

    // ============================================
    // EVENTS
    // ============================================

    #[event]
    struct OrderCreatedEvent has drop, store {
        id: vector<u8>,
        recipient_cooked: vector<u8>,  // No plaintext addresses
    }

    #[event]
    struct OrderStatusChangedEvent has drop, store {
        id: vector<u8>,
        from_status: u8,
        to_status: u8,
        action: u8,
    }

    #[event]
    struct OrderClaimedEvent has drop, store {
        id: vector<u8>,
        claim_key_hash: vector<u8>,
    }

    #[event]
    struct OrderRevokedEvent has drop, store {
        id: vector<u8>,
        refund_key_hash: vector<u8>,
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    /// Initialize the send pool
    public entry fun initialize(
        deployer: &signer,
        iusd_fa: Object<Metadata>,
        treasury: address,
        fee_bps: u64,
        fee_cap: u64,  // Max fee in micro units (0 = no cap)
        admin_pubkey: vector<u8>,
    ) {
        let deployer_addr = signer::address_of(deployer);
        assert!(!exists<SendPool>(deployer_addr), error::already_exists(E_ALREADY_INITIALIZED));

        let constructor_ref = object::create_object(deployer_addr, false);
        let extend_ref = object::generate_extend_ref(&constructor_ref);

        move_to(deployer, SendPool {
            extend_ref,
            iusd_fa,
            owner: deployer_addr,
            treasury,
            fee_bps,
            fee_cap,
            admin_pubkey,
            merkle_root: vector::empty(),
            tree_size: 0,
            total_orders: 0,
            total_volume: 0,
            total_fees: 0,
            orders: table::new(),
            nullifiers: table::new(),
            user_orders: table::new(),
            cooked_index: table::new(),
            claim_key_index: table::new(),
            refund_key_index: table::new(),
            relayers: table::new(),
            pending_orders: vector::empty(),
        });
        
        // Initialize ViewingKeyBackups storage
        move_to(deployer, ViewingKeyBackups {
            backups: table::new(),
        });
    }

    // ============================================
    // ENTRY FUNCTIONS - STATE TRANSITIONS
    // ============================================

    /// A1: Deposit - Sender creates order and deposits funds
    /// S0 created (implicit, order created)
    public entry fun deposit(
        sender: &signer,
        pool_addr: address,
        id: vector<u8>,
        amount: u64,
        expires_at: u64,
        // Encrypted data
        ciphertext: vector<u8>,
        key_for_sender: vector<u8>,
        key_for_recipient: vector<u8>,
        key_for_admin: vector<u8>,
        sender_cooked: vector<u8>,
        recipient_cooked: vector<u8>,
        claim_key_hash: vector<u8>,
        refund_key_hash: vector<u8>,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);

        // Validations
        assert!(!table::contains(&pool.orders, id), error::already_exists(E_NOT_INITIALIZED));
        assert!(amount >= MIN_AMOUNT && amount <= MAX_AMOUNT, error::invalid_argument(E_INVALID_AMOUNT));

        // Calculate fee with cap
        let fee = (amount * pool.fee_bps) / 10000;
        // Apply cap if set (fee_cap > 0)
        if (pool.fee_cap > 0 && fee > pool.fee_cap) {
            fee = pool.fee_cap;
        };
        // User pays amount + fee (fee is extra, not deducted from recipient)

        // Transfer funds: amount to pool, fee to treasury
        let pool_object_addr = object::address_from_extend_ref(&pool.extend_ref);
        primary_fungible_store::transfer(sender, pool.iusd_fa, pool_object_addr, amount);
        if (fee > 0) {
            primary_fungible_store::transfer(sender, pool.iusd_fa, pool.treasury, fee);
            pool.total_fees = pool.total_fees + fee;
        };

        let (_, now) = block::get_block_info();

        // Create order
        let order = SendOrder {
            id,
            status: STATUS_CREATED,
            created_at: now,
            expires_at,
            ciphertext,
            key_for_sender,
            key_for_recipient,
            key_for_admin,
            sender_cooked,
            recipient_cooked,
            claim_key_hash,
            refund_key_hash,
            amount,  // Full amount (fee paid separately by sender)
            claimed_by: @0x0,
            claimed_at: 0,
        };

        // Store order
        table::add(&mut pool.orders, id, order);

        // Index by cooked addresses
        if (!table::contains(&pool.cooked_index, sender_cooked)) {
            table::add(&mut pool.cooked_index, sender_cooked, vector::empty());
        };
        let sender_orders = table::borrow_mut(&mut pool.cooked_index, sender_cooked);
        vector::push_back(sender_orders, id);

        if (!table::contains(&pool.cooked_index, recipient_cooked)) {
            table::add(&mut pool.cooked_index, recipient_cooked, vector::empty());
        };
        let recipient_orders = table::borrow_mut(&mut pool.cooked_index, recipient_cooked);
        vector::push_back(recipient_orders, id);

        // Index by claim_key_hash and refund_key_hash
        table::add(&mut pool.claim_key_index, claim_key_hash, id);
        table::add(&mut pool.refund_key_index, refund_key_hash, id);

        // Update stats
        pool.total_orders = pool.total_orders + 1;
        pool.total_volume = pool.total_volume + amount;
        
        // Add to pending_orders for Relayer to process
        vector::push_back(&mut pool.pending_orders, id);

        event::emit(OrderCreatedEvent { id, recipient_cooked });
    }

    /// A2: Spend - Relayer advances order to pending_claim
    /// S0 created -> S1 processing -> S2 pending_claim
    /// REQUIRES: Caller must be an authorized relayer
    public entry fun spend(
        relayer: &signer,
        pool_addr: address,
        id: vector<u8>,
        nullifier: vector<u8>,
        merkle_root: vector<u8>,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        let relayer_addr = signer::address_of(relayer);
        
        // Verify relayer is authorized (owner is always authorized)
        assert!(
            relayer_addr == pool.owner || table::contains(&pool.relayers, relayer_addr),
            error::permission_denied(E_NOT_RELAYER)
        );

        // Verify nullifier not spent
        assert!(!table::contains(&pool.nullifiers, nullifier), error::invalid_state(E_NULLIFIER_USED));
        
        // Get and validate order
        assert!(table::contains(&pool.orders, id), error::not_found(E_ORDER_NOT_FOUND));
        let order = table::borrow_mut(&mut pool.orders, id);
        
        assert!(order.status == STATUS_CREATED, error::invalid_state(E_INVALID_TRANSITION));
        order_common::check_not_expired(order.expires_at);

        // Mark nullifier as spent
        table::add(&mut pool.nullifiers, nullifier, true);

        // Update merkle root
        pool.merkle_root = merkle_root;
        pool.tree_size = pool.tree_size + 1;

        // Transition to pending_claim
        let from_status = order.status;
        order.status = STATUS_PENDING_CLAIM;
        
        // Remove from pending_orders
        let (found, index) = vector::index_of(&pool.pending_orders, &id);
        if (found) {
            vector::remove(&mut pool.pending_orders, index);
        };

        event::emit(OrderStatusChangedEvent {
            id,
            from_status,
            to_status: STATUS_PENDING_CLAIM,
            action: ACTION_SPEND,
        });
    }

    /// A2b: Spend to Pending Register - Relayer processes order but recipient has no viewing pubkey
    /// S0 created -> S8 pending_register
    /// REQUIRES: Caller must be an authorized relayer
    public entry fun spend_pending_register(
        relayer: &signer,
        pool_addr: address,
        id: vector<u8>,
        nullifier: vector<u8>,
        merkle_root: vector<u8>,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        let relayer_addr = signer::address_of(relayer);
        
        // Verify relayer is authorized
        assert!(
            relayer_addr == pool.owner || table::contains(&pool.relayers, relayer_addr),
            error::permission_denied(E_NOT_RELAYER)
        );

        // Verify nullifier not spent
        assert!(!table::contains(&pool.nullifiers, nullifier), error::invalid_state(E_NULLIFIER_USED));
        
        // Get and validate order
        assert!(table::contains(&pool.orders, id), error::not_found(E_ORDER_NOT_FOUND));
        let order = table::borrow_mut(&mut pool.orders, id);
        
        assert!(order.status == STATUS_CREATED, error::invalid_state(E_INVALID_TRANSITION));
        order_common::check_not_expired(order.expires_at);

        // Mark nullifier as spent
        table::add(&mut pool.nullifiers, nullifier, true);

        // Update merkle root
        pool.merkle_root = merkle_root;
        pool.tree_size = pool.tree_size + 1;

        // Transition to pending_register (recipient needs to register viewing key first)
        let from_status = order.status;
        order.status = STATUS_PENDING_REGISTER;
        
        // Remove from pending_orders
        let (found, index) = vector::index_of(&pool.pending_orders, &id);
        if (found) {
            vector::remove(&mut pool.pending_orders, index);
        };

        event::emit(OrderStatusChangedEvent {
            id,
            from_status,
            to_status: STATUS_PENDING_REGISTER,
            action: ACTION_SPEND,
        });
    }

    /// A8: Activate - Relayer activates pending_register order after recipient registers pubkey
    /// S8 pending_register -> S2 pending_claim
    /// REQUIRES: Caller must be an authorized relayer
    public entry fun activate_order(
        relayer: &signer,
        pool_addr: address,
        id: vector<u8>,
        new_key_for_recipient: vector<u8>,  // Re-encrypted with recipient's new pubkey
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        let relayer_addr = signer::address_of(relayer);
        
        // Verify relayer is authorized
        assert!(
            relayer_addr == pool.owner || table::contains(&pool.relayers, relayer_addr),
            error::permission_denied(E_NOT_RELAYER)
        );
        
        // Get and validate order
        assert!(table::contains(&pool.orders, id), error::not_found(E_ORDER_NOT_FOUND));
        let order = table::borrow_mut(&mut pool.orders, id);
        
        // Must be in PENDING_REGISTER state
        assert!(order.status == STATUS_PENDING_REGISTER, error::invalid_state(E_INVALID_TRANSITION));
        order_common::check_not_expired(order.expires_at);
        
        // Update key_for_recipient with new encrypted version
        order.key_for_recipient = new_key_for_recipient;
        
        // Transition to pending_claim
        let from_status = order.status;
        order.status = STATUS_PENDING_CLAIM;
        
        event::emit(OrderStatusChangedEvent {
            id,
            from_status,
            to_status: STATUS_PENDING_CLAIM,
            action: ACTION_ACTIVATE,
        });
    }

    /// A3: Claim - Recipient claims funds
    /// S2 pending_claim -> S3 confirmed
    public entry fun claim(
        recipient: &signer,
        pool_addr: address,
        claim_key: vector<u8>,  // 32 bytes secret
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        let recipient_addr = signer::address_of(recipient);
        
        let key_hash = hash::sha2_256(claim_key);
        
        // Find order by claim_key_hash
        let id = find_order_by_claim_key(pool, &key_hash);
        assert!(vector::length(&id) > 0, error::not_found(E_ORDER_NOT_FOUND));
        
        let order = table::borrow_mut(&mut pool.orders, id);
        assert!(order.status == STATUS_PENDING_CLAIM, error::invalid_state(E_INVALID_TRANSITION));
        order_common::check_not_expired(order.expires_at);
        
        // Verify claim key
        assert!(key_hash == order.claim_key_hash, error::permission_denied(E_INVALID_KEY));

        // Transfer funds to recipient
        let amount = order.amount;
        let pool_signer = object::generate_signer_for_extending(&pool.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool.iusd_fa, recipient_addr, amount);

        // Update status and record who claimed
        let (_, now) = block::get_block_info();
        let from_status = order.status;
        order.status = STATUS_CONFIRMED;
        order.claimed_by = recipient_addr;
        order.claimed_at = now;

        event::emit(OrderClaimedEvent { id, claim_key_hash: key_hash });
        event::emit(OrderStatusChangedEvent {
            id,
            from_status,
            to_status: STATUS_CONFIRMED,
            action: ACTION_CLAIM,
        });
    }

    /// A3b: Claim For - Relayer claims on behalf of user (gas sponsorship)
    /// Only owner or authorized relayers can call this
    public entry fun claim_for(
        relayer: &signer,
        pool_addr: address,
        recipient_addr: address,  // User who receives the funds
        claim_key: vector<u8>,    // 32 bytes secret (user decrypted and sent to API)
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        let relayer_addr = signer::address_of(relayer);
        
        // Only owner or relayers can sponsor
        assert!(
            relayer_addr == pool.owner || table::contains(&pool.relayers, relayer_addr),
            error::permission_denied(E_NOT_RELAYER)
        );
        
        let key_hash = hash::sha2_256(claim_key);
        
        // Find order by claim_key_hash
        let id = find_order_by_claim_key(pool, &key_hash);
        assert!(vector::length(&id) > 0, error::not_found(E_ORDER_NOT_FOUND));
        
        let order = table::borrow_mut(&mut pool.orders, id);
        assert!(order.status == STATUS_PENDING_CLAIM, error::invalid_state(E_INVALID_TRANSITION));
        order_common::check_not_expired(order.expires_at);
        
        // Verify claim key
        assert!(key_hash == order.claim_key_hash, error::permission_denied(E_INVALID_KEY));

        // Transfer funds to recipient (NOT relayer)
        let amount = order.amount;
        let pool_signer = object::generate_signer_for_extending(&pool.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool.iusd_fa, recipient_addr, amount);

        // Update status and record who claimed
        let (_, now) = block::get_block_info();
        let from_status = order.status;
        order.status = STATUS_CONFIRMED;
        order.claimed_by = recipient_addr;
        order.claimed_at = now;

        event::emit(OrderClaimedEvent { id, claim_key_hash: key_hash });
        event::emit(OrderStatusChangedEvent {
            id,
            from_status,
            to_status: STATUS_CONFIRMED,
            action: ACTION_CLAIM,
        });
    }

    /// A4: Reject - Recipient rejects and auto-refunds sender
    /// S2 pending_claim -> S4 rejected (with auto refund)
    public entry fun reject(
        recipient: &signer,
        pool_addr: address,
        claim_key: vector<u8>,
        sender_addr: address,  // Decrypted from ciphertext by recipient
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        let _recipient_addr = signer::address_of(recipient);
        
        let key_hash = hash::sha2_256(claim_key);
        
        // Find and validate order
        let id = find_order_by_claim_key(pool, &key_hash);
        assert!(vector::length(&id) > 0, error::not_found(E_ORDER_NOT_FOUND));
        
        let order = table::borrow_mut(&mut pool.orders, id);
        assert!(order.status == STATUS_PENDING_CLAIM, error::invalid_state(E_INVALID_TRANSITION));
        order_common::check_not_expired(order.expires_at);
        assert!(key_hash == order.claim_key_hash, error::permission_denied(E_INVALID_KEY));

        // Auto refund to sender
        let amount = order.amount;
        let pool_signer = object::generate_signer_for_extending(&pool.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool.iusd_fa, sender_addr, amount);

        // Update status
        let from_status = order.status;
        order.status = STATUS_REJECTED;

        event::emit(OrderStatusChangedEvent {
            id,
            from_status,
            to_status: STATUS_REJECTED,
            action: ACTION_REJECT,
        });
    }

    /// A5: Revoke - Sender revokes and gets refund
    /// S2 pending_claim -> S5 revoked
    public entry fun revoke(
        sender: &signer,
        pool_addr: address,
        refund_key: vector<u8>,  // 32 bytes secret
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        let sender_addr = signer::address_of(sender);
        
        let key_hash = hash::sha2_256(refund_key);
        
        // Find order by refund_key_hash
        let id = find_order_by_refund_key(pool, &key_hash);
        assert!(vector::length(&id) > 0, error::not_found(E_ORDER_NOT_FOUND));
        
        let order = table::borrow_mut(&mut pool.orders, id);
        // Allow revoke from PENDING_CLAIM or PENDING_REGISTER states
        assert!(
            order.status == STATUS_PENDING_CLAIM || order.status == STATUS_PENDING_REGISTER,
            error::invalid_state(E_INVALID_TRANSITION)
        );
        order_common::check_not_expired(order.expires_at);
        assert!(key_hash == order.refund_key_hash, error::permission_denied(E_INVALID_KEY));

        // Refund to sender
        let amount = order.amount;
        let pool_signer = object::generate_signer_for_extending(&pool.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool.iusd_fa, sender_addr, amount);

        // Update status
        let from_status = order.status;
        order.status = STATUS_REVOKED;

        event::emit(OrderRevokedEvent { id, refund_key_hash: key_hash });
        event::emit(OrderStatusChangedEvent {
            id,
            from_status,
            to_status: STATUS_REVOKED,
            action: ACTION_REVOKE,
        });
    }

    /// A6: Refund - Recipient voluntarily refunds after claiming
    /// S3 confirmed -> S6 refunded
    /// REQUIRES: Caller must be the same address that claimed the order
    public entry fun refund(
        recipient: &signer,
        pool_addr: address,
        id: vector<u8>,
        sender_addr: address,
        amount: u64,
    ) acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        let recipient_addr = signer::address_of(recipient);
        
        // Validate order exists and is confirmed
        assert!(table::contains(&pool.orders, id), error::not_found(E_ORDER_NOT_FOUND));
        let order = table::borrow(&pool.orders, id);
        assert!(order.status == STATUS_CONFIRMED, error::invalid_state(E_INVALID_TRANSITION));
        
        // CRITICAL: Verify caller is the one who claimed this order
        assert!(order.claimed_by == recipient_addr, error::permission_denied(E_NOT_RECIPIENT));
        
        // Transfer from recipient to sender (uses recipient's balance)
        primary_fungible_store::transfer(recipient, pool.iusd_fa, sender_addr, amount);

        // Update status (need mutable borrow)
        let pool_mut = borrow_global_mut<SendPool>(pool_addr);
        let order_mut = table::borrow_mut(&mut pool_mut.orders, id);
        let from_status = order_mut.status;
        order_mut.status = STATUS_REFUNDED;

        event::emit(OrderStatusChangedEvent {
            id,
            from_status,
            to_status: STATUS_REFUNDED,
            action: ACTION_REFUND,
        });
    }

    /// A7: Expire - System expires unclaimed orders
    /// S2 pending_claim -> S7 expired
    public entry fun expire(
        admin: &signer,
        pool_addr: address,
        id: vector<u8>,
        sender_addr: address,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        
        // Only owner can call expire
        assert!(signer::address_of(admin) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        
        assert!(table::contains(&pool.orders, id), error::not_found(E_ORDER_NOT_FOUND));
        let order = table::borrow_mut(&mut pool.orders, id);
        assert!(order.status == STATUS_PENDING_CLAIM, error::invalid_state(E_INVALID_TRANSITION));
        assert!(order_common::is_expired(order.expires_at), error::invalid_state(E_ORDER_EXPIRED));

        // Refund to sender
        let amount = order.amount;
        let pool_signer = object::generate_signer_for_extending(&pool.extend_ref);
        primary_fungible_store::transfer(&pool_signer, pool.iusd_fa, sender_addr, amount);

        // Update status
        let from_status = order.status;
        order.status = STATUS_EXPIRED;

        event::emit(OrderStatusChangedEvent {
            id,
            from_status,
            to_status: STATUS_EXPIRED,
            action: ACTION_EXPIRE,
        });
    }

    /// A9: Intervene - Admin manually resolves stuck order
    /// Any -> S8 intervened
    public entry fun intervene(
        admin: &signer,
        pool_addr: address,
        id: vector<u8>,
        new_status: u8,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        assert!(signer::address_of(admin) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        
        assert!(table::contains(&pool.orders, id), error::not_found(E_ORDER_NOT_FOUND));
        let order = table::borrow_mut(&mut pool.orders, id);
        
        let from_status = order.status;
        order.status = new_status;

        event::emit(OrderStatusChangedEvent {
            id,
            from_status,
            to_status: new_status,
            action: ACTION_INTERVENE,
        });
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    /// Transfer ownership to new admin
    public entry fun transfer_ownership(
        owner: &signer,
        pool_addr: address,
        new_owner: address,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        pool.owner = new_owner;
    }

    /// Update treasury address
    public entry fun set_treasury(
        owner: &signer,
        pool_addr: address,
        new_treasury: address,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        pool.treasury = new_treasury;
    }

    /// Update fee basis points
    public entry fun set_fee_bps(
        owner: &signer,
        pool_addr: address,
        new_fee_bps: u64,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        assert!(new_fee_bps <= 1000, error::invalid_argument(E_INVALID_AMOUNT)); // Max 10%
        pool.fee_bps = new_fee_bps;
    }

    /// Update fee cap (0 = no cap)
    public entry fun set_fee_cap(
        owner: &signer,
        pool_addr: address,
        new_fee_cap: u64,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        pool.fee_cap = new_fee_cap;
    }

    /// Update admin public key (for encryption)
    public entry fun set_admin_pubkey(
        owner: &signer,
        pool_addr: address,
        new_admin_pubkey: vector<u8>,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        pool.admin_pubkey = new_admin_pubkey;
    }

    /// Initialize ViewingKeyBackups storage (one-time, for existing pools)
    public entry fun init_viewing_key_storage(
        owner: &signer,
        pool_addr: address,
    ) acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        assert!(!exists<ViewingKeyBackups>(pool_addr), error::already_exists(E_ALREADY_INITIALIZED));
        
        move_to(owner, ViewingKeyBackups {
            backups: table::new(),
        });
    }

    /// Add an authorized relayer
    public entry fun add_relayer(
        owner: &signer,
        pool_addr: address,
        relayer_addr: address,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        if (!table::contains(&pool.relayers, relayer_addr)) {
            table::add(&mut pool.relayers, relayer_addr, true);
        };
    }

    /// Remove an authorized relayer
    public entry fun remove_relayer(
        owner: &signer,
        pool_addr: address,
        relayer_addr: address,
    ) acquires SendPool {
        let pool = borrow_global_mut<SendPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        if (table::contains(&pool.relayers, relayer_addr)) {
            table::remove(&mut pool.relayers, relayer_addr);
        };
    }

    /// Check if address is an authorized relayer
    #[view]
    public fun is_relayer(pool_addr: address, addr: address): bool acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        addr == pool.owner || table::contains(&pool.relayers, addr)
    }

    // ============================================
    // USER SETTINGS
    // ============================================

    /// Set auto-claim preference
    public entry fun set_auto_claim(
        user: &signer,
        auto_claim: bool,
    ) acquires UserSettings {
        let user_addr = signer::address_of(user);
        if (exists<UserSettings>(user_addr)) {
            let settings = borrow_global_mut<UserSettings>(user_addr);
            settings.auto_claim = auto_claim;
        } else {
            move_to(user, UserSettings {
                auto_claim,
                viewing_pubkey: vector::empty(),
                viewing_pubkey_type: VIEWING_PUBKEY_TYPE_UNKNOWN,
            });
        };
    }

    /// Set viewing public key with signature type
    /// @param viewing_pubkey_type: 0=Unknown, 1=EIP-191, 2=ADR-036
    public entry fun set_viewing_pubkey(
        user: &signer,
        viewing_pubkey: vector<u8>,
        viewing_pubkey_type: u8,
    ) acquires UserSettings {
        let user_addr = signer::address_of(user);
        if (exists<UserSettings>(user_addr)) {
            let settings = borrow_global_mut<UserSettings>(user_addr);
            settings.viewing_pubkey = viewing_pubkey;
            settings.viewing_pubkey_type = viewing_pubkey_type;
        } else {
            move_to(user, UserSettings {
                auto_claim: false,
                viewing_pubkey,
                viewing_pubkey_type,
            });
        };
    }

    /// Set viewing pubkey for a user (relayer-sponsored, no gas needed by user)
    /// Only owner or authorized relayers can call this
    /// Stores in SponsoredViewingKeys table at @ipay
    public entry fun set_viewing_pubkey_for(
        relayer: &signer,
        pool_addr: address,
        user_addr: address,
        viewing_pubkey: vector<u8>,
        viewing_pubkey_type: u8,
    ) acquires SendPool, SponsoredViewingKeys {
        let pool = borrow_global<SendPool>(pool_addr);
        let relayer_addr = signer::address_of(relayer);
        
        // Only owner or relayers can sponsor
        assert!(
            relayer_addr == pool.owner || table::contains(&pool.relayers, relayer_addr),
            error::permission_denied(E_NOT_RELAYER)
        );
        
        // Initialize SponsoredViewingKeys if not exists
        if (!exists<SponsoredViewingKeys>(@ipay)) {
            move_to(&object::generate_signer_for_extending(&pool.extend_ref), SponsoredViewingKeys {
                keys: table::new(),
            });
        };
        
        // Store sponsored key
        let sponsored = borrow_global_mut<SponsoredViewingKeys>(@ipay);
        let key = SponsoredKey {
            viewing_pubkey,
            viewing_pubkey_type,
        };
        
        if (table::contains(&sponsored.keys, user_addr)) {
            *table::borrow_mut(&mut sponsored.keys, user_addr) = key;
        } else {
            table::add(&mut sponsored.keys, user_addr, key);
        };
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /// Get orders by cooked address (with optional dummy obfuscation)
    #[view]
    public fun get_orders_by_cooked(
        pool_addr: address,
        cooked_address: vector<u8>,
        include_dummies: bool,
        offset: u64,
        limit: u64,
    ): vector<SendOrder> acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        let result = vector::empty<SendOrder>();
        
        if (!table::contains(&pool.cooked_index, cooked_address)) {
            return result
        };
        
        let ids = table::borrow(&pool.cooked_index, cooked_address);
        let len = vector::length(ids);
        
        let i = offset;
        let count = 0u64;
        while (i < len && count < limit) {
            let id = *vector::borrow(ids, i);
            if (table::contains(&pool.orders, id)) {
                let order = *table::borrow(&pool.orders, id);
                vector::push_back(&mut result, order);
                count = count + 1;
            };
            i = i + 1;
        };

        // Add dummies if requested (simple implementation)
        if (include_dummies && count > 0) {
            let (_, now) = block::get_block_info();
            let dummy_count = (now % 3) + 1; // 1-3 dummies
            let d = 0u64;
            while (d < dummy_count) {
                let dummy = create_dummy_order(now + d, cooked_address);
                vector::push_back(&mut result, dummy);
                d = d + 1;
            };
        };

        result
    }

    /// Get single order by ID
    #[view]
    public fun get_order(
        pool_addr: address,
        id: vector<u8>,
    ): Option<SendOrder> acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        if (table::contains(&pool.orders, id)) {
            option::some(*table::borrow(&pool.orders, id))
        } else {
            option::none()
        }
    }

    /// Get order count for a cooked address
    #[view]
    public fun get_order_count(
        pool_addr: address,
        cooked_address: vector<u8>,
    ): u64 acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        if (table::contains(&pool.cooked_index, cooked_address)) {
            vector::length(table::borrow(&pool.cooked_index, cooked_address))
        } else {
            0
        }
    }

    /// Get pool stats
    #[view]
    public fun get_pool_stats(pool_addr: address): (u64, u64, u64) acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        (pool.total_orders, pool.total_volume, pool.total_fees)
    }

    /// Get pool config
    #[view]
    public fun get_pool_config(pool_addr: address): (address, address, u64, u64) acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        (pool.owner, pool.treasury, pool.fee_bps, pool.fee_cap)
    }

    /// Get user settings
    /// Returns (auto_claim, viewing_pubkey, viewing_pubkey_type)
    /// viewing_pubkey_type: 0=Unknown, 1=EIP-191, 2=ADR-036
    #[view]
    public fun get_user_settings(user_addr: address): (bool, vector<u8>, u8) acquires UserSettings {
        if (exists<UserSettings>(user_addr)) {
            let settings = borrow_global<UserSettings>(user_addr);
            (settings.auto_claim, settings.viewing_pubkey, settings.viewing_pubkey_type)
        } else {
            (false, vector::empty(), 0)
        }
    }

    /// Get user's viewing pubkey (checks both user settings and sponsored keys)
    #[view]
    public fun get_viewing_pubkey(user_addr: address): (vector<u8>, u8) acquires UserSettings, SponsoredViewingKeys {
        // First check user's own settings
        if (exists<UserSettings>(user_addr)) {
            let settings = borrow_global<UserSettings>(user_addr);
            if (vector::length(&settings.viewing_pubkey) > 0) {
                return (settings.viewing_pubkey, settings.viewing_pubkey_type)
            }
        };
        
        // Then check sponsored keys
        if (exists<SponsoredViewingKeys>(@ipay)) {
            let sponsored = borrow_global<SponsoredViewingKeys>(@ipay);
            if (table::contains(&sponsored.keys, user_addr)) {
                let key = table::borrow(&sponsored.keys, user_addr);
                return (key.viewing_pubkey, key.viewing_pubkey_type)
            }
        };
        
        // No viewing key found
        (vector::empty(), 0)
    }

    /// Check if user has auto-claim enabled
    #[view]
    public fun is_auto_claim_enabled(user_addr: address): bool acquires UserSettings {
        if (exists<UserSettings>(user_addr)) {
            borrow_global<UserSettings>(user_addr).auto_claim
        } else {
            false
        }
    }

    /// Get pending orders (for Relayer)
    /// Returns ids with STATUS_CREATED that need spend() called
    #[view]
    public fun get_pending_orders(pool_addr: address): vector<vector<u8>> acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        pool.pending_orders
    }

    /// Get count of pending orders
    #[view]
    public fun get_pending_orders_count(pool_addr: address): u64 acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        vector::length(&pool.pending_orders)
    }

    /// Get order by claim_key_hash
    /// Returns (status, created_at, expires_at) or abort if not found
    #[view]
    public fun get_order_by_claim_key(
        pool_addr: address,
        claim_key_hash: vector<u8>,
    ): (u8, u64, u64) acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        let id = find_order_by_claim_key(pool, &claim_key_hash);
        assert!(vector::length(&id) > 0, error::not_found(E_ORDER_NOT_FOUND));
        
        let order = table::borrow(&pool.orders, id);
        (order.status, order.created_at, order.expires_at)
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    fun find_order_by_claim_key(pool: &SendPool, key_hash: &vector<u8>): vector<u8> {
        if (table::contains(&pool.claim_key_index, *key_hash)) {
            *table::borrow(&pool.claim_key_index, *key_hash)
        } else {
            vector::empty()
        }
    }

    fun find_order_by_refund_key(pool: &SendPool, key_hash: &vector<u8>): vector<u8> {
        if (table::contains(&pool.refund_key_index, *key_hash)) {
            *table::borrow(&pool.refund_key_index, *key_hash)
        } else {
            vector::empty()
        }
    }

    fun create_dummy_order(seed: u64, cooked: vector<u8>): SendOrder {
        SendOrder {
            id: order_common::generate_dummy_id(seed, @0x0),
            status: STATUS_PENDING_CLAIM,
            created_at: seed,
            expires_at: seed + DEFAULT_CLAIM_TTL,
            ciphertext: vector::empty(),
            key_for_sender: vector::empty(),
            key_for_recipient: vector::empty(),
            key_for_admin: vector::empty(),
            sender_cooked: cooked,
            recipient_cooked: cooked,
            claim_key_hash: vector::empty(),
            refund_key_hash: vector::empty(),
            amount: 0,
            claimed_by: @0x0,
            claimed_at: 0,
        }
    }

    // ============================================
    // VIEWING KEY BACKUP
    // ============================================

    /// Backup encrypted viewing key on-chain
    /// Can only be set once per address to prevent accidental overwrites
    public entry fun backup_viewing_key(
        user: &signer,
        pool_addr: address,
        encrypted_key: vector<u8>,
        sign_type: u8,
    ) acquires ViewingKeyBackups {
        let user_addr = signer::address_of(user);
        
        // ViewingKeyBackups is initialized in initialize()
        let backups = borrow_global_mut<ViewingKeyBackups>(pool_addr);
        
        // Check if backup already exists - only allow first-time backup
        assert!(!table::contains(&backups.backups, user_addr), error::already_exists(E_BACKUP_EXISTS));
        
        // Store backup
        let (_, now) = block::get_block_info();
        table::add(&mut backups.backups, user_addr, ViewingKeyBackup {
            encrypted_key,
            sign_type,
            created_at: now,
        });
    }

    #[view]
    /// Get viewing key backup for an address
    public fun get_viewing_key_backup(
        pool_addr: address,
        user_addr: address,
    ): (vector<u8>, u8, u64) acquires ViewingKeyBackups {
        if (!exists<ViewingKeyBackups>(pool_addr)) {
            return (vector::empty(), 0, 0)
        };
        
        let backups = borrow_global<ViewingKeyBackups>(pool_addr);
        if (!table::contains(&backups.backups, user_addr)) {
            return (vector::empty(), 0, 0)
        };
        
        let backup = table::borrow(&backups.backups, user_addr);
        (backup.encrypted_key, backup.sign_type, backup.created_at)
    }

    #[view]
    /// Check if viewing key backup exists
    public fun has_viewing_key_backup(
        pool_addr: address,
        user_addr: address,
    ): bool acquires ViewingKeyBackups {
        if (!exists<ViewingKeyBackups>(pool_addr)) {
            return false
        };
        let backups = borrow_global<ViewingKeyBackups>(pool_addr);
        table::contains(&backups.backups, user_addr)
    }

    #[view]
    /// Get ids with PENDING_REGISTER status (for relayer activation)
    public fun get_pending_register_ids(pool_addr: address): vector<vector<u8>> acquires SendPool {
        let pool = borrow_global<SendPool>(pool_addr);
        let result = vector::empty<vector<u8>>();
        
        // Iterate through pending_orders and find PENDING_REGISTER ones
        let pending = &pool.pending_orders;
        let i = 0;
        let len = vector::length(pending);
        
        while (i < len) {
            let id = vector::borrow(pending, i);
            if (table::contains(&pool.orders, *id)) {
                let order = table::borrow(&pool.orders, *id);
                if (order.status == STATUS_PENDING_REGISTER) {
                    vector::push_back(&mut result, *id);
                };
            };
            i = i + 1;
        };
        
        result
    }
}
