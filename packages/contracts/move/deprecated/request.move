/// iPay Request Order Contract
/// 
/// Payment Request: Requester creates a request, Payer fulfills it
///
/// State Machine:
/// R0 created -> R1 pending_pay -> R2 confirmed (paid)
///                              -> R3 rejected
///                              -> R5 expired
/// R0 created -> R4 cancelled (by requester)
/// Any -> R6 intervened (admin only)
///
/// All sensitive data is encrypted off-chain. Contract stores:
/// - ciphertext (encrypted payload)
/// - key_for_requester (ECIES encrypted random key)
/// - key_for_payer (ECIES encrypted random key) 
/// - key_for_admin (ECIES encrypted random key)
module ipay::request {
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

    const ORDER_TYPE: u8 = 2; // ORDER_TYPE_REQUEST

    // Status codes for Request orders
    const STATUS_CREATED: u8 = 0;
    const STATUS_PENDING_PAY: u8 = 1;  // Awaiting payment
    const STATUS_CONFIRMED: u8 = 2;    // Paid
    const STATUS_REJECTED: u8 = 3;     // Payer rejected
    const STATUS_CANCELLED: u8 = 4;    // Requester cancelled
    const STATUS_EXPIRED: u8 = 5;
    const STATUS_INTERVENED: u8 = 99;

    // Action codes
    const ACTION_CREATE: u8 = 1;
    const ACTION_NOTIFY: u8 = 2;     // Notify payer (off-chain)
    const ACTION_PAY: u8 = 3;
    const ACTION_REJECT: u8 = 4;
    const ACTION_CANCEL: u8 = 5;
    const ACTION_EXPIRE: u8 = 6;
    const ACTION_INTERVENE: u8 = 9;

    // Error codes
    const E_NOT_INITIALIZED: u64 = 100;
    const E_ALREADY_INITIALIZED: u64 = 101;
    const E_INVALID_TRANSITION: u64 = 102;
    const E_ORDER_NOT_FOUND: u64 = 103;
    const E_NOT_AUTHORIZED: u64 = 104;
    const E_ORDER_EXPIRED: u64 = 105;
    const E_INVALID_KEY: u64 = 106;
    const E_INVALID_AMOUNT: u64 = 107;
    const E_ALREADY_EXISTS: u64 = 108;

    // Config
    const DEFAULT_REQUEST_TTL: u64 = 7 * 24 * 60 * 60; // 7 days
    const MIN_AMOUNT: u64 = 10000;   // 0.01 iUSD
    const MAX_AMOUNT: u64 = 100000000000; // 100,000 iUSD

    // ============================================
    // STRUCTS
    // ============================================

    /// Request pool configuration and state
    struct RequestPool has key {
        extend_ref: ExtendRef,
        iusd_fa: Object<Metadata>,
        owner: address,
        treasury: address,
        fee_bps: u64,
        admin_pubkey: vector<u8>,
        
        // Stats
        total_requests: u64,
        total_paid: u64,
        total_fees: u64,
        
        // Tables
        requests: Table<vector<u8>, RequestOrder>,           // request_id -> order
        requester_index: Table<vector<u8>, vector<vector<u8>>>, // requester_cooked -> request_ids
        payer_index: Table<vector<u8>, vector<vector<u8>>>,     // payer_cooked -> request_ids
        pay_key_index: Table<vector<u8>, vector<u8>>,        // pay_key_hash -> request_id
    }

    /// Request order (encrypted)
    struct RequestOrder has store, drop, copy {
        request_id: vector<u8>,
        status: u8,
        created_at: u64,
        expires_at: u64,
        
        // Encrypted data (off-chain encryption)
        // Contains: amount, memo, requester_addr, payer_addr (optional)
        ciphertext: vector<u8>,
        key_for_requester: vector<u8>,  // ECIES(requester_pubkey, random_key)
        key_for_payer: vector<u8>,      // ECIES(payer_pubkey, random_key) - set when payer known
        key_for_admin: vector<u8>,      // ECIES(admin_pubkey, random_key)
        
        // Indexing (cooked addresses)
        requester_cooked: vector<u8>,
        payer_cooked: vector<u8>,       // May be empty for open requests
        
        // Payment keys
        pay_key_hash: vector<u8>,       // SHA256(pay_key) - for payer to pay
        cancel_key_hash: vector<u8>,    // SHA256(cancel_key) - for requester to cancel
        
        // Amount (stored for accounting, not exposed in view)
        amount: u64,
        
        // Payment tracking
        paid_at: u64,
        paid_by: address,
    }

    // ============================================
    // EVENTS
    // ============================================

    #[event]
    struct RequestCreatedEvent has drop, store {
        request_id: vector<u8>,
        requester_cooked: vector<u8>,
        payer_cooked: vector<u8>,  // May be empty
    }

    #[event]
    struct RequestStatusChangedEvent has drop, store {
        request_id: vector<u8>,
        from_status: u8,
        to_status: u8,
        action: u8,
    }

    #[event]
    struct RequestPaidEvent has drop, store {
        request_id: vector<u8>,
        pay_key_hash: vector<u8>,
        amount: u64,
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    /// Initialize the request pool
    public entry fun initialize(
        deployer: &signer,
        iusd_fa: Object<Metadata>,
        treasury: address,
        fee_bps: u64,
        admin_pubkey: vector<u8>,
    ) {
        let deployer_addr = signer::address_of(deployer);
        assert!(!exists<RequestPool>(deployer_addr), error::already_exists(E_ALREADY_INITIALIZED));

        let constructor_ref = object::create_object(deployer_addr, false);
        let extend_ref = object::generate_extend_ref(&constructor_ref);

        move_to(deployer, RequestPool {
            extend_ref,
            iusd_fa,
            owner: deployer_addr,
            treasury,
            fee_bps,
            admin_pubkey,
            total_requests: 0,
            total_paid: 0,
            total_fees: 0,
            requests: table::new(),
            requester_index: table::new(),
            payer_index: table::new(),
            pay_key_index: table::new(),
        });
    }

    // ============================================
    // ENTRY FUNCTIONS - STATE TRANSITIONS
    // ============================================

    /// A1: Create - Requester creates a payment request
    /// -> R0 created -> R1 pending_pay (immediate)
    public entry fun create_request(
        requester: &signer,
        pool_addr: address,
        request_id: vector<u8>,
        amount: u64,
        expires_at: u64,
        // Encrypted data
        ciphertext: vector<u8>,
        key_for_requester: vector<u8>,
        key_for_payer: vector<u8>,
        key_for_admin: vector<u8>,
        requester_cooked: vector<u8>,
        payer_cooked: vector<u8>,
        pay_key_hash: vector<u8>,
        cancel_key_hash: vector<u8>,
    ) acquires RequestPool {
        let pool = borrow_global_mut<RequestPool>(pool_addr);
        let _requester_addr = signer::address_of(requester);

        // Validations
        assert!(!table::contains(&pool.requests, request_id), error::already_exists(E_ALREADY_EXISTS));
        assert!(amount >= MIN_AMOUNT && amount <= MAX_AMOUNT, error::invalid_argument(E_INVALID_AMOUNT));

        let (_, now) = block::get_block_info();

        // Create request order (starts as pending_pay)
        let request = RequestOrder {
            request_id,
            status: STATUS_PENDING_PAY,
            created_at: now,
            expires_at,
            ciphertext,
            key_for_requester,
            key_for_payer,
            key_for_admin,
            requester_cooked,
            payer_cooked,
            pay_key_hash,
            cancel_key_hash,
            amount,
            paid_at: 0,
            paid_by: @0x0,
        };

        // Store request
        table::add(&mut pool.requests, request_id, request);

        // Index by requester cooked address
        if (!table::contains(&pool.requester_index, requester_cooked)) {
            table::add(&mut pool.requester_index, requester_cooked, vector::empty());
        };
        let requester_requests = table::borrow_mut(&mut pool.requester_index, requester_cooked);
        vector::push_back(requester_requests, request_id);

        // Index by payer cooked address (if specified)
        if (vector::length(&payer_cooked) > 0) {
            if (!table::contains(&pool.payer_index, payer_cooked)) {
                table::add(&mut pool.payer_index, payer_cooked, vector::empty());
            };
            let payer_requests = table::borrow_mut(&mut pool.payer_index, payer_cooked);
            vector::push_back(payer_requests, request_id);
        };

        // Index by pay_key_hash
        table::add(&mut pool.pay_key_index, pay_key_hash, request_id);

        // Update stats
        pool.total_requests = pool.total_requests + 1;

        event::emit(RequestCreatedEvent { 
            request_id, 
            requester_cooked,
            payer_cooked,
        });
    }

    /// A3: Pay - Payer fulfills the payment request
    /// R1 pending_pay -> R2 confirmed
    public entry fun pay(
        payer: &signer,
        pool_addr: address,
        pay_key: vector<u8>,  // 32 bytes secret
        requester_addr: address,  // Decrypted from ciphertext
    ) acquires RequestPool {
        let pool = borrow_global_mut<RequestPool>(pool_addr);
        let payer_addr = signer::address_of(payer);
        
        let key_hash = hash::sha2_256(pay_key);
        
        // Find request by pay_key_hash
        assert!(table::contains(&pool.pay_key_index, key_hash), error::not_found(E_ORDER_NOT_FOUND));
        let request_id = *table::borrow(&pool.pay_key_index, key_hash);
        
        let request = table::borrow_mut(&mut pool.requests, request_id);
        assert!(request.status == STATUS_PENDING_PAY, error::invalid_state(E_INVALID_TRANSITION));
        order_common::check_not_expired(request.expires_at);
        assert!(key_hash == request.pay_key_hash, error::permission_denied(E_INVALID_KEY));

        let amount = request.amount;
        
        // Calculate fee
        let fee = (amount * pool.fee_bps) / 10000;
        let net_amount = amount - fee;

        // Transfer from payer to requester
        primary_fungible_store::transfer(payer, pool.iusd_fa, requester_addr, net_amount);
        
        // Transfer fee to treasury
        if (fee > 0) {
            primary_fungible_store::transfer(payer, pool.iusd_fa, pool.treasury, fee);
            pool.total_fees = pool.total_fees + fee;
        };

        // Update request
        let (_, now) = block::get_block_info();
        let from_status = request.status;
        request.status = STATUS_CONFIRMED;
        request.paid_at = now;
        request.paid_by = payer_addr;

        // Update stats
        pool.total_paid = pool.total_paid + amount;

        event::emit(RequestPaidEvent { request_id, pay_key_hash: key_hash, amount });
        event::emit(RequestStatusChangedEvent {
            request_id,
            from_status,
            to_status: STATUS_CONFIRMED,
            action: ACTION_PAY,
        });
    }

    /// A4: Reject - Payer rejects the request
    /// R1 pending_pay -> R3 rejected
    public entry fun reject(
        payer: &signer,
        pool_addr: address,
        pay_key: vector<u8>,
    ) acquires RequestPool {
        let pool = borrow_global_mut<RequestPool>(pool_addr);
        let _payer_addr = signer::address_of(payer);
        
        let key_hash = hash::sha2_256(pay_key);
        
        // Find and validate request
        assert!(table::contains(&pool.pay_key_index, key_hash), error::not_found(E_ORDER_NOT_FOUND));
        let request_id = *table::borrow(&pool.pay_key_index, key_hash);
        
        let request = table::borrow_mut(&mut pool.requests, request_id);
        assert!(request.status == STATUS_PENDING_PAY, error::invalid_state(E_INVALID_TRANSITION));
        assert!(key_hash == request.pay_key_hash, error::permission_denied(E_INVALID_KEY));

        // Update status
        let from_status = request.status;
        request.status = STATUS_REJECTED;

        event::emit(RequestStatusChangedEvent {
            request_id,
            from_status,
            to_status: STATUS_REJECTED,
            action: ACTION_REJECT,
        });
    }

    /// A5: Cancel - Requester cancels their own request
    /// R1 pending_pay -> R4 cancelled
    public entry fun cancel(
        requester: &signer,
        pool_addr: address,
        cancel_key: vector<u8>,
    ) acquires RequestPool {
        let pool = borrow_global_mut<RequestPool>(pool_addr);
        let _requester_addr = signer::address_of(requester);
        
        let key_hash = hash::sha2_256(cancel_key);
        
        // Find request by iterating (would need cancel_key_index for O(1))
        let request_id = find_request_by_cancel_key(pool, &key_hash);
        assert!(vector::length(&request_id) > 0, error::not_found(E_ORDER_NOT_FOUND));
        
        let request = table::borrow_mut(&mut pool.requests, request_id);
        assert!(request.status == STATUS_PENDING_PAY, error::invalid_state(E_INVALID_TRANSITION));
        assert!(key_hash == request.cancel_key_hash, error::permission_denied(E_INVALID_KEY));

        // Update status
        let from_status = request.status;
        request.status = STATUS_CANCELLED;

        event::emit(RequestStatusChangedEvent {
            request_id,
            from_status,
            to_status: STATUS_CANCELLED,
            action: ACTION_CANCEL,
        });
    }

    /// A6: Expire - System expires unpaid requests
    /// R1 pending_pay -> R5 expired
    public entry fun expire(
        admin: &signer,
        pool_addr: address,
        request_id: vector<u8>,
    ) acquires RequestPool {
        let pool = borrow_global_mut<RequestPool>(pool_addr);
        
        // Only owner can call expire
        assert!(signer::address_of(admin) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        
        assert!(table::contains(&pool.requests, request_id), error::not_found(E_ORDER_NOT_FOUND));
        let request = table::borrow_mut(&mut pool.requests, request_id);
        assert!(request.status == STATUS_PENDING_PAY, error::invalid_state(E_INVALID_TRANSITION));
        assert!(order_common::is_expired(request.expires_at), error::invalid_state(E_ORDER_EXPIRED));

        // Update status
        let from_status = request.status;
        request.status = STATUS_EXPIRED;

        event::emit(RequestStatusChangedEvent {
            request_id,
            from_status,
            to_status: STATUS_EXPIRED,
            action: ACTION_EXPIRE,
        });
    }

    /// A9: Intervene - Admin manually resolves stuck request
    /// Any -> R6 intervened
    public entry fun intervene(
        admin: &signer,
        pool_addr: address,
        request_id: vector<u8>,
        new_status: u8,
    ) acquires RequestPool {
        let pool = borrow_global_mut<RequestPool>(pool_addr);
        assert!(signer::address_of(admin) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        
        assert!(table::contains(&pool.requests, request_id), error::not_found(E_ORDER_NOT_FOUND));
        let request = table::borrow_mut(&mut pool.requests, request_id);
        
        let from_status = request.status;
        request.status = new_status;

        event::emit(RequestStatusChangedEvent {
            request_id,
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
    ) acquires RequestPool {
        let pool = borrow_global_mut<RequestPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        pool.owner = new_owner;
    }

    /// Update treasury address
    public entry fun set_treasury(
        owner: &signer,
        pool_addr: address,
        new_treasury: address,
    ) acquires RequestPool {
        let pool = borrow_global_mut<RequestPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        pool.treasury = new_treasury;
    }

    /// Update fee basis points
    public entry fun set_fee_bps(
        owner: &signer,
        pool_addr: address,
        new_fee_bps: u64,
    ) acquires RequestPool {
        let pool = borrow_global_mut<RequestPool>(pool_addr);
        assert!(signer::address_of(owner) == pool.owner, error::permission_denied(E_NOT_AUTHORIZED));
        assert!(new_fee_bps <= 1000, error::invalid_argument(E_INVALID_AMOUNT)); // Max 10%
        pool.fee_bps = new_fee_bps;
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    #[view]
    public fun get_requests_by_requester(
        pool_addr: address,
        requester_cooked: vector<u8>,
        offset: u64,
        limit: u64,
    ): vector<RequestOrder> acquires RequestPool {
        let pool = borrow_global<RequestPool>(pool_addr);
        let result = vector::empty<RequestOrder>();
        
        if (!table::contains(&pool.requester_index, requester_cooked)) {
            return result
        };
        
        let request_ids = table::borrow(&pool.requester_index, requester_cooked);
        let len = vector::length(request_ids);
        
        let i = offset;
        let count = 0u64;
        while (i < len && count < limit) {
            let request_id = *vector::borrow(request_ids, i);
            if (table::contains(&pool.requests, request_id)) {
                let request = *table::borrow(&pool.requests, request_id);
                vector::push_back(&mut result, request);
                count = count + 1;
            };
            i = i + 1;
        };

        result
    }

    #[view]
    public fun get_requests_by_payer(
        pool_addr: address,
        payer_cooked: vector<u8>,
        offset: u64,
        limit: u64,
    ): vector<RequestOrder> acquires RequestPool {
        let pool = borrow_global<RequestPool>(pool_addr);
        let result = vector::empty<RequestOrder>();
        
        if (!table::contains(&pool.payer_index, payer_cooked)) {
            return result
        };
        
        let request_ids = table::borrow(&pool.payer_index, payer_cooked);
        let len = vector::length(request_ids);
        
        let i = offset;
        let count = 0u64;
        while (i < len && count < limit) {
            let request_id = *vector::borrow(request_ids, i);
            if (table::contains(&pool.requests, request_id)) {
                let request = *table::borrow(&pool.requests, request_id);
                vector::push_back(&mut result, request);
                count = count + 1;
            };
            i = i + 1;
        };

        result
    }

    #[view]
    public fun get_request(
        pool_addr: address,
        request_id: vector<u8>,
    ): Option<RequestOrder> acquires RequestPool {
        let pool = borrow_global<RequestPool>(pool_addr);
        if (table::contains(&pool.requests, request_id)) {
            option::some(*table::borrow(&pool.requests, request_id))
        } else {
            option::none()
        }
    }

    #[view]
    public fun get_request_count_by_requester(
        pool_addr: address,
        requester_cooked: vector<u8>,
    ): u64 acquires RequestPool {
        let pool = borrow_global<RequestPool>(pool_addr);
        if (table::contains(&pool.requester_index, requester_cooked)) {
            vector::length(table::borrow(&pool.requester_index, requester_cooked))
        } else {
            0
        }
    }

    #[view]
    public fun get_pool_stats(pool_addr: address): (u64, u64, u64) acquires RequestPool {
        let pool = borrow_global<RequestPool>(pool_addr);
        (pool.total_requests, pool.total_paid, pool.total_fees)
    }

    #[view]
    public fun get_pool_config(pool_addr: address): (address, address, u64) acquires RequestPool {
        let pool = borrow_global<RequestPool>(pool_addr);
        (pool.owner, pool.treasury, pool.fee_bps)
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================

    fun find_request_by_cancel_key(pool: &RequestPool, key_hash: &vector<u8>): vector<u8> {
        // Note: Would need cancel_key_index for O(1) lookup
        // For now, this is a placeholder - in production add index
        let _ = pool;
        let _ = key_hash;
        vector::empty()
    }
}
