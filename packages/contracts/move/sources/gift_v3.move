/// iPay Gift V3 - Red Envelope / Gift Box Payment
///
/// Admin configures box types (BoxDef) on-chain.
/// Users send gifts by selecting a box_id.
/// Recipients claim via secret proof (group) or address check (direct).
///
/// State Machine:
///   send_gift / send_gift_group -> ACTIVE
///     claim_direct / claim_slot  -> slot CLAIMED
///     expire_and_refund          -> unclaimed slots EXPIRED, refund to sender
///
/// Security:
///   Group claims use per-slot derived secrets with address-bound proofs
///   to prevent MEV frontrunning and TX-based secret leakage.
module ipay::gift_v3 {
    use std::error;
    use std::signer;
    use std::string::String;
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

    const MODE_DIRECT: u8 = 0;
    const MODE_GROUP:  u8 = 1;

    const SLOT_OPEN:    u8 = 0;
    const SLOT_CLAIMED: u8 = 1;
    const SLOT_EXPIRED: u8 = 2;

    const STATUS_ACTIVE:    u8 = 0;
    const STATUS_COMPLETED: u8 = 1;  // all slots claimed
    const STATUS_EXPIRED:   u8 = 2;  // expire_and_refund called

    const MIN_AMOUNT: u64 = 100_000;          // 0.1 iUSD
    const DEFAULT_CAP: u64 = 1_000_000_000;   // 1000 iUSD
    const MAX_SLOTS: u64 = 200;
    const MAX_TTL: u64 = 7 * 24 * 60 * 60;   // 7 days (in seconds)
    const MIN_SLOT_SHARE: u64 = 10_000;       // 0.01 iUSD minimum per slot

    // -- Error Codes -----------------------------------------------------
    const E_NOT_AUTHORIZED:   u64 = 400;
    const E_NOT_SPONSOR:      u64 = 401;
    const E_BOX_NOT_FOUND:    u64 = 402;
    const E_BOX_DISABLED:     u64 = 403;
    const E_BOX_EXISTS:       u64 = 404;
    const E_AMOUNT_TOO_LOW:   u64 = 405;
    const E_AMOUNT_TOO_HIGH:  u64 = 406;
    const E_AMOUNT_MISMATCH:  u64 = 407;
    const E_TOO_MANY_SLOTS:   u64 = 408;
    const E_PACKET_NOT_FOUND: u64 = 409;
    const E_PACKET_EXPIRED:   u64 = 410;
    const E_PACKET_NOT_EXPIRED: u64 = 411;
    const E_SLOT_NOT_OPEN:    u64 = 412;
    const E_SLOT_OUT_OF_RANGE: u64 = 413;
    const E_INVALID_SECRET:   u64 = 414;
    const E_INVALID_PROOF:    u64 = 415;
    const E_NOT_RECIPIENT:    u64 = 416;
    const E_NOT_SENDER:       u64 = 417;
    const E_DUPLICATE_PACKET: u64 = 418;
    const E_INVALID_TTL:      u64 = 419;
    const E_WRONG_MODE:       u64 = 420;
    const E_ZERO_SLOTS:       u64 = 421;
    const E_FIXED_AMOUNT:     u64 = 422;

    // ====================================================================
    // STRUCTS
    // ====================================================================

    /// Admin-configured gift box type
    struct BoxDef has store, drop, copy {
        box_id:   u64,
        name:     String,
        amount:   u64,             // fixed amount (0 = flexible, user chooses)
        fee_bps:  u64,             // fee rate in basis points (50 = 0.5%)
        urls:     vector<String>,  // display asset URLs
        enabled:  bool,
    }

    /// A single slot in a group gift
    struct GiftSlot has store, drop, copy {
        amount:     u64,
        status:     u8,        // OPEN / CLAIMED / EXPIRED
        claimed_by: address,
        claimed_at: u64,
    }

    /// A sent gift packet
    struct GiftPacket has store {
        packet_id:     vector<u8>,
        box_id:        u64,
        sender:        address,
        mode:          u8,             // DIRECT or GROUP

        // -- Direct mode --
        // Privacy: recipient identity is NOT stored as `address` on chain.
        // `recipient_blob` is an ECIES ciphertext of {shortId, address,
        // claimKey, memo, timestamp} encrypted for the recipient's and
        // admin's viewing pubkeys. Only the intended recipient (or admin
        // for audit) can decrypt. Observers see opaque bytes.
        // `claim_key_hash` is the sha2_256 of the bearer claim_key; the
        // claim path verifies hash(claim_key) == claim_key_hash to
        // authorize the claim. The plaintext claim_key is embedded in
        // the ECIES blob, so only the intended recipient can recover it.
        recipient_blob: vector<u8>,    // ECIES ciphertext; empty for GROUP mode
        claim_key_hash: vector<u8>,    // sha2_256(claim_key); empty for GROUP mode
        amount:        u64,            // total face value (public)

        // -- Group mode --
        total_slots:   u64,
        claimed_slots: u64,
        slots:         vector<GiftSlot>,
        slot_hashes:   vector<vector<u8>>,  // verify_hash per slot
        allocation_seed: vector<u8>,         // for amount derivation

        // -- Common --
        fee:           u64,
        status:        u8,
        created_at:    u64,
        expires_at:    u64,
    }

    /// Pool object
    struct GiftPoolV3 has key {
        extend_ref: ExtendRef,
        iusd_fa:    Object<Metadata>,
        owner:      address,            // original creator (always an owner)
        owners:     Table<address, bool>, // multi-owner registry
        treasury:   address,
        cap:        u64,               // max amount per gift (configurable)

        // Box registry
        boxes:      Table<u64, BoxDef>,
        box_ids:    vector<u64>,       // ordered list for iteration

        // Gift packets
        packets:    Table<vector<u8>, GiftPacket>,

        // Sponsors (relayers)
        sponsors:   Table<address, bool>,

        // Stats
        total_gifts:  u64,
        total_volume: u64,
        total_fees:   u64,
    }

    // ====================================================================
    // EVENTS
    // ====================================================================

    #[event]
    struct BoxRegisteredEvent has drop, store {
        pool: address, box_id: u64, name: String, amount: u64, fee_bps: u64, enabled: bool,
    }

    #[event]
    struct BoxUpdatedEvent has drop, store {
        pool: address, box_id: u64, name: String, amount: u64, fee_bps: u64, enabled: bool,
    }

    #[event]
    struct BoxRemovedEvent has drop, store {
        pool: address, box_id: u64,
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
    struct BoxListedEvent has drop, store {
        pool: address, box_id: u64,
    }

    #[event]
    struct BoxDelistedEvent has drop, store {
        pool: address, box_id: u64,
    }

    #[event]
    struct GiftSentEvent has drop, store {
        pool: address, packet_id: vector<u8>, sender: address,
        box_id: u64, mode: u8, amount: u64, fee: u64,
        total_slots: u64, expires_at: u64,
    }

    #[event]
    struct GiftClaimedEvent has drop, store {
        pool: address, packet_id: vector<u8>,
        slot_index: u64, claimed_by: address, amount: u64,
    }

    #[event]
    struct GiftExpiredEvent has drop, store {
        pool: address, packet_id: vector<u8>, sender: address,
        refund_amount: u64, unclaimed_slots: u64,
    }

    // ====================================================================
    // POOL CREATION (deployer only)
    // ====================================================================

    /// Entry point for creating a pool via CLI
    public entry fun init_pool(
        owner: &signer,
        iusd_fa: Object<Metadata>,
    ) {
        create_pool(owner, iusd_fa);
    }

    public fun create_pool(
        owner: &signer,
        iusd_fa: Object<Metadata>,
    ): Object<GiftPoolV3> {
        let owner_addr = signer::address_of(owner);
        assert!(owner_addr == @ipay, error::permission_denied(E_NOT_AUTHORIZED));

        let constructor_ref = object::create_object(owner_addr, false);
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let object_signer = object::generate_signer(&constructor_ref);

        let owners = table::new();
        table::add(&mut owners, owner_addr, true);

        move_to(&object_signer, GiftPoolV3 {
            extend_ref,
            iusd_fa,
            owner: owner_addr,
            owners,
            treasury: owner_addr,
            cap: DEFAULT_CAP,
            boxes: table::new(),
            box_ids: vector::empty(),
            packets: table::new(),
            sponsors: table::new(),
            total_gifts: 0,
            total_volume: 0,
            total_fees: 0,
        });

        object::object_from_constructor_ref<GiftPoolV3>(&constructor_ref)
    }

    // ====================================================================
    // ADMIN: POOL CONFIG
    // ====================================================================

    public entry fun set_cap(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        new_cap: u64,
    ) acquires GiftPoolV3 {
        assert_owner(pool, signer::address_of(admin));
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        d.cap = new_cap;
    }

    public entry fun set_treasury(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        new_treasury: address,
    ) acquires GiftPoolV3 {
        assert_owner(pool, signer::address_of(admin));
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        d.treasury = new_treasury;
    }

    public entry fun add_sponsor(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        sponsor: address,
    ) acquires GiftPoolV3 {
        assert_owner(pool, signer::address_of(admin));
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        if (!table::contains(&d.sponsors, sponsor)) {
            table::add(&mut d.sponsors, sponsor, true);
        } else {
            *table::borrow_mut(&mut d.sponsors, sponsor) = true;
        };
    }

    public entry fun remove_sponsor(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        sponsor: address,
    ) acquires GiftPoolV3 {
        assert_owner(pool, signer::address_of(admin));
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        if (table::contains(&d.sponsors, sponsor)) {
            *table::borrow_mut(&mut d.sponsors, sponsor) = false;
        };
    }

    // ====================================================================
    // ADMIN: OWNER MANAGEMENT
    // ====================================================================

    /// Add a new owner (multi-admin). Only existing owners can add.
    public entry fun add_owner(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        new_owner: address,
    ) acquires GiftPoolV3 {
        let admin_addr = signer::address_of(admin);
        assert_owner(pool, admin_addr);
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        if (!table::contains(&d.owners, new_owner)) {
            table::add(&mut d.owners, new_owner, true);
        } else {
            *table::borrow_mut(&mut d.owners, new_owner) = true;
        };

        event::emit(OwnerAddedEvent {
            pool: object::object_address(&pool), new_owner, added_by: admin_addr,
        });
    }

    /// Remove an owner. Cannot remove the original creator.
    public entry fun remove_owner(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        target_owner: address,
    ) acquires GiftPoolV3 {
        let admin_addr = signer::address_of(admin);
        assert_owner(pool, admin_addr);
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        // Cannot remove the original creator
        assert!(target_owner != d.owner, error::permission_denied(E_NOT_AUTHORIZED));
        if (table::contains(&d.owners, target_owner)) {
            *table::borrow_mut(&mut d.owners, target_owner) = false;
        };

        event::emit(OwnerRemovedEvent {
            pool: object::object_address(&pool), removed_owner: target_owner, removed_by: admin_addr,
        });
    }

    // ====================================================================
    // EMERGENCY WITHDRAW
    // ====================================================================

    /// Emergency withdraw funds stuck in the pool to a target address.
    /// Only owners can call. Use when bugs trap funds in the contract.
    public entry fun emergency_withdraw(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        to: address,
        amount: u64,
    ) acquires GiftPoolV3 {
        let admin_addr = signer::address_of(admin);
        assert_owner(pool, admin_addr);
        let pool_addr = object::object_address(&pool);
        let d = borrow_global<GiftPoolV3>(pool_addr);
        let pool_signer = object::generate_signer_for_extending(&d.extend_ref);
        primary_fungible_store::transfer(&pool_signer, d.iusd_fa, to, amount);
        event::emit(EmergencyWithdrawEvent {
            pool: pool_addr, to, amount, withdrawn_by: admin_addr,
        });
    }

    // ====================================================================
    // ADMIN: BOX MANAGEMENT
    // ====================================================================

    public entry fun register_box(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        box_id: u64,
        name: String,
        amount: u64,
        fee_bps: u64,
        urls: vector<String>,
        enabled: bool,
    ) acquires GiftPoolV3 {
        assert_owner(pool, signer::address_of(admin));
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        assert!(!table::contains(&d.boxes, box_id), error::already_exists(E_BOX_EXISTS));

        let def = BoxDef { box_id, name, amount, fee_bps, urls, enabled };
        table::add(&mut d.boxes, box_id, def);
        vector::push_back(&mut d.box_ids, box_id);

        event::emit(BoxRegisteredEvent {
            pool: object::object_address(&pool),
            box_id, name, amount, fee_bps, enabled,
        });
    }

    public entry fun update_box(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        box_id: u64,
        name: String,
        amount: u64,
        fee_bps: u64,
        urls: vector<String>,
        enabled: bool,
    ) acquires GiftPoolV3 {
        assert_owner(pool, signer::address_of(admin));
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        assert!(table::contains(&d.boxes, box_id), error::not_found(E_BOX_NOT_FOUND));

        let def = table::borrow_mut(&mut d.boxes, box_id);
        *def = BoxDef { box_id, name, amount, fee_bps, urls, enabled };

        event::emit(BoxUpdatedEvent {
            pool: object::object_address(&pool),
            box_id, name, amount, fee_bps, enabled,
        });
    }

    public entry fun remove_box(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        box_id: u64,
    ) acquires GiftPoolV3 {
        assert_owner(pool, signer::address_of(admin));
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        assert!(table::contains(&d.boxes, box_id), error::not_found(E_BOX_NOT_FOUND));

        table::remove(&mut d.boxes, box_id);
        // Remove from box_ids vector
        let (found, idx) = vector::index_of(&d.box_ids, &box_id);
        if (found) {
            vector::remove(&mut d.box_ids, idx);
        };

        event::emit(BoxRemovedEvent {
            pool: object::object_address(&pool), box_id,
        });
    }

    /// List a box - enable it for the shop
    public entry fun list_box(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        box_id: u64,
    ) acquires GiftPoolV3 {
        assert_owner(pool, signer::address_of(admin));
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        assert!(table::contains(&d.boxes, box_id), error::not_found(E_BOX_NOT_FOUND));

        let def = table::borrow_mut(&mut d.boxes, box_id);
        def.enabled = true;

        event::emit(BoxListedEvent {
            pool: object::object_address(&pool), box_id,
        });
    }

    /// Delist a box - disable it; any send using this box_id will fail
    public entry fun delist_box(
        admin: &signer,
        pool: Object<GiftPoolV3>,
        box_id: u64,
    ) acquires GiftPoolV3 {
        assert_owner(pool, signer::address_of(admin));
        let d = borrow_global_mut<GiftPoolV3>(object::object_address(&pool));
        assert!(table::contains(&d.boxes, box_id), error::not_found(E_BOX_NOT_FOUND));

        let def = table::borrow_mut(&mut d.boxes, box_id);
        def.enabled = false;

        event::emit(BoxDelistedEvent {
            pool: object::object_address(&pool), box_id,
        });
    }

    // ====================================================================
    // SENDER: DIRECT GIFT (mode A)
    // ====================================================================

    /// Send a gift to a specific recipient. No address is exposed on chain.
    ///
    /// Privacy model:
    ///   - `recipient_blob`: ECIES ciphertext of {shortId, address, claimKey,
    ///     memo, timestamp} encrypted for both the intended recipient's
    ///     viewing pubkey AND the admin viewing pubkey. Observers see opaque
    ///     bytes; only recipient (or admin for compliance audit) can decrypt.
    ///   - `claim_key_hash`: sha2_256 of the bearer claim_key. The plaintext
    ///     claim_key lives inside `recipient_blob`, so only the intended
    ///     recipient can recover it and present the preimage during claim.
    ///
    /// If box has fixed amount, `amount` param is ignored.
    /// If box has flexible amount (0), sender must provide amount.
    public entry fun send_gift(
        sender: &signer,
        pool: Object<GiftPoolV3>,
        box_id: u64,
        packet_id: vector<u8>,
        recipient_blob: vector<u8>,
        claim_key_hash: vector<u8>,
        amount: u64,       // ignored if box has fixed amount
        ttl: u64,          // 0 = use MAX_TTL
    ) acquires GiftPoolV3 {
        let sender_addr = signer::address_of(sender);
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPoolV3>(pool_addr);

        assert!(!table::contains(&d.packets, packet_id), error::already_exists(E_DUPLICATE_PACKET));

        // Validate box
        assert!(table::contains(&d.boxes, box_id), error::not_found(E_BOX_NOT_FOUND));
        let box = *table::borrow(&d.boxes, box_id);
        assert!(box.enabled, error::invalid_state(E_BOX_DISABLED));

        // Resolve amount
        let gift_amount = if (box.amount > 0) {
            box.amount  // fixed
        } else {
            assert!(amount >= MIN_AMOUNT, error::invalid_argument(E_AMOUNT_TOO_LOW));
            assert!(amount <= d.cap, error::invalid_argument(E_AMOUNT_TOO_HIGH));
            amount
        };

        // Calculate fee
        let fee = compute_fee(gift_amount, box.fee_bps);

        // Validate TTL
        let ttl_val = if (ttl > 0 && ttl <= MAX_TTL) { ttl } else { MAX_TTL };
        let now = block::get_current_block_height();

        // Transfer amount + fee from sender to pool
        primary_fungible_store::transfer(sender, d.iusd_fa, pool_addr, gift_amount + fee);

        // Route fee to treasury immediately
        if (fee > 0) {
            let pool_signer = object::generate_signer_for_extending(&d.extend_ref);
            primary_fungible_store::transfer(&pool_signer, d.iusd_fa, d.treasury, fee);
        };

        // Create packet
        let packet = GiftPacket {
            packet_id,
            box_id,
            sender: sender_addr,
            mode: MODE_DIRECT,
            recipient_blob,
            claim_key_hash,
            amount: gift_amount,
            total_slots: 1,
            claimed_slots: 0,
            slots: vector::empty(),
            slot_hashes: vector::empty(),
            allocation_seed: vector::empty(),
            fee,
            status: STATUS_ACTIVE,
            created_at: now,
            expires_at: now + ttl_val,
        };

        table::add(&mut d.packets, packet_id, packet);
        d.total_gifts = d.total_gifts + 1;
        d.total_volume = d.total_volume + gift_amount;
        d.total_fees = d.total_fees + fee;

        event::emit(GiftSentEvent {
            pool: pool_addr, packet_id, sender: sender_addr,
            box_id, mode: MODE_DIRECT, amount: gift_amount, fee,
            total_slots: 1, expires_at: now + ttl_val,
        });
    }

    // ====================================================================
    // SENDER: GROUP GIFT (mode B - red envelope)
    // ====================================================================

    /// Send a group gift with N slots. Amounts are randomly allocated on-chain.
    /// slot_hashes[i] = SHA256(SHA256(claim_key || le_bytes(i)))
    /// allocation_seed is used for deterministic random amount distribution.
    public entry fun send_gift_group(
        sender: &signer,
        pool: Object<GiftPoolV3>,
        box_id: u64,
        packet_id: vector<u8>,
        num_slots: u64,
        amount: u64,            // ignored if box has fixed amount
        allocation_seed: vector<u8>,   // 32 bytes, for random split
        slot_hashes: vector<vector<u8>>,  // verify hashes per slot
        ttl: u64,
    ) acquires GiftPoolV3 {
        let sender_addr = signer::address_of(sender);
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPoolV3>(pool_addr);

        assert!(!table::contains(&d.packets, packet_id), error::already_exists(E_DUPLICATE_PACKET));
        assert!(num_slots > 0, error::invalid_argument(E_ZERO_SLOTS));
        assert!(num_slots <= MAX_SLOTS, error::invalid_argument(E_TOO_MANY_SLOTS));
        assert!(vector::length(&slot_hashes) == num_slots, error::invalid_argument(E_TOO_MANY_SLOTS));

        // Validate box
        assert!(table::contains(&d.boxes, box_id), error::not_found(E_BOX_NOT_FOUND));
        let box = *table::borrow(&d.boxes, box_id);
        assert!(box.enabled, error::invalid_state(E_BOX_DISABLED));

        // Resolve total amount
        let gift_amount = if (box.amount > 0) {
            box.amount
        } else {
            assert!(amount >= MIN_AMOUNT, error::invalid_argument(E_AMOUNT_TOO_LOW));
            assert!(amount <= d.cap, error::invalid_argument(E_AMOUNT_TOO_HIGH));
            amount
        };

        // Calculate fee
        let fee = compute_fee(gift_amount, box.fee_bps);

        // Validate TTL
        let ttl_val = if (ttl > 0 && ttl <= MAX_TTL) { ttl } else { MAX_TTL };
        let now = block::get_current_block_height();

        // Transfer amount + fee
        primary_fungible_store::transfer(sender, d.iusd_fa, pool_addr, gift_amount + fee);
        if (fee > 0) {
            let pool_signer = object::generate_signer_for_extending(&d.extend_ref);
            primary_fungible_store::transfer(&pool_signer, d.iusd_fa, d.treasury, fee);
        };

        // Allocate amounts to slots using on-chain deterministic random
        let slots = allocate_slots(gift_amount, num_slots, &allocation_seed);

        // Create packet
        let packet = GiftPacket {
            packet_id,
            box_id,
            sender: sender_addr,
            mode: MODE_GROUP,
            recipient_blob: vector::empty<u8>(),   // Group mode: bearer via slot_hashes
            claim_key_hash: vector::empty<u8>(),   // Group mode: no Direct-style claim_key
            amount: gift_amount,
            total_slots: num_slots,
            claimed_slots: 0,
            slots,
            slot_hashes,
            allocation_seed,
            fee,
            status: STATUS_ACTIVE,
            created_at: now,
            expires_at: now + ttl_val,
        };

        table::add(&mut d.packets, packet_id, packet);
        d.total_gifts = d.total_gifts + 1;
        d.total_volume = d.total_volume + gift_amount;
        d.total_fees = d.total_fees + fee;

        event::emit(GiftSentEvent {
            pool: pool_addr, packet_id, sender: sender_addr,
            box_id, mode: MODE_GROUP, amount: gift_amount, fee,
            total_slots: num_slots, expires_at: now + ttl_val,
        });
    }

    /// Send a group gift with N slots. Amounts are equally split.
    /// Each slot gets floor(amount / num_slots), last slot gets remainder.
    /// slot_hashes[i] = SHA256(SHA256(claim_key || le_bytes(i)))
    public entry fun send_gift_group_equal(
        sender: &signer,
        pool: Object<GiftPoolV3>,
        box_id: u64,
        packet_id: vector<u8>,
        num_slots: u64,
        amount: u64,            // ignored if box has fixed amount
        slot_hashes: vector<vector<u8>>,  // verify hashes per slot
        ttl: u64,
    ) acquires GiftPoolV3 {
        let sender_addr = signer::address_of(sender);
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPoolV3>(pool_addr);

        assert!(!table::contains(&d.packets, packet_id), error::already_exists(E_DUPLICATE_PACKET));
        assert!(num_slots > 0, error::invalid_argument(E_ZERO_SLOTS));
        assert!(num_slots <= MAX_SLOTS, error::invalid_argument(E_TOO_MANY_SLOTS));
        assert!(vector::length(&slot_hashes) == num_slots, error::invalid_argument(E_TOO_MANY_SLOTS));

        // Validate box
        assert!(table::contains(&d.boxes, box_id), error::not_found(E_BOX_NOT_FOUND));
        let box = *table::borrow(&d.boxes, box_id);
        assert!(box.enabled, error::invalid_state(E_BOX_DISABLED));

        // Resolve total amount
        let gift_amount = if (box.amount > 0) {
            box.amount
        } else {
            assert!(amount >= MIN_AMOUNT, error::invalid_argument(E_AMOUNT_TOO_LOW));
            assert!(amount <= d.cap, error::invalid_argument(E_AMOUNT_TOO_HIGH));
            amount
        };

        // Calculate fee
        let fee = compute_fee(gift_amount, box.fee_bps);

        // Validate TTL
        let ttl_val = if (ttl > 0 && ttl <= MAX_TTL) { ttl } else { MAX_TTL };
        let now = block::get_current_block_height();

        // Transfer amount + fee
        primary_fungible_store::transfer(sender, d.iusd_fa, pool_addr, gift_amount + fee);
        if (fee > 0) {
            let pool_signer = object::generate_signer_for_extending(&d.extend_ref);
            primary_fungible_store::transfer(&pool_signer, d.iusd_fa, d.treasury, fee);
        };

        // Equal split: floor(amount / num_slots), last slot gets remainder
        let slots = allocate_slots_equal(gift_amount, num_slots);

        // Create packet
        let packet = GiftPacket {
            packet_id,
            box_id,
            sender: sender_addr,
            mode: MODE_GROUP,
            recipient_blob: vector::empty<u8>(),
            claim_key_hash: vector::empty<u8>(),
            amount: gift_amount,
            total_slots: num_slots,
            claimed_slots: 0,
            slots,
            slot_hashes,
            allocation_seed: vector::empty(),
            fee,
            status: STATUS_ACTIVE,
            created_at: now,
            expires_at: now + ttl_val,
        };

        table::add(&mut d.packets, packet_id, packet);
        d.total_gifts = d.total_gifts + 1;
        d.total_volume = d.total_volume + gift_amount;
        d.total_fees = d.total_fees + fee;

        event::emit(GiftSentEvent {
            pool: pool_addr, packet_id, sender: sender_addr,
            box_id, mode: MODE_GROUP, amount: gift_amount, fee,
            total_slots: num_slots, expires_at: now + ttl_val,
        });
    }

    // ====================================================================
    // RECIPIENT: CLAIM DIRECT (mode A)
    // ====================================================================

    /// Claim a direct gift. Caller must present the claim_key whose
    /// sha2_256 matches packet.claim_key_hash. The claim_key was embedded
    /// in the ECIES-encrypted recipient_blob at send time, so only the
    /// intended recipient (or admin for compliance) can recover it.
    public entry fun claim_direct(
        claimer: &signer,
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
        claim_key: vector<u8>,
    ) acquires GiftPoolV3 {
        let claimer_addr = signer::address_of(claimer);
        claim_direct_internal(pool, packet_id, claim_key, claimer_addr);
    }

    /// Sponsor claims direct gift on behalf of recipient. The sponsor
    /// relayer supplies both the claim_key (recovered off-chain from the
    /// recipient_blob via the recipient's viewing_sk) and the destination
    /// address to transfer funds to.
    public entry fun sponsor_claim_direct(
        sponsor: &signer,
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
        claim_key: vector<u8>,
        recipient: address,
    ) acquires GiftPoolV3 {
        assert_sponsor(pool, signer::address_of(sponsor));
        claim_direct_internal(pool, packet_id, claim_key, recipient);
    }

    fun claim_direct_internal(
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
        claim_key: vector<u8>,
        recipient_addr: address,
    ) acquires GiftPoolV3 {
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPoolV3>(pool_addr);
        let packet = table::borrow_mut(&mut d.packets, packet_id);

        assert!(packet.mode == MODE_DIRECT, error::invalid_argument(E_WRONG_MODE));
        assert!(packet.status == STATUS_ACTIVE, error::invalid_state(E_SLOT_NOT_OPEN));

        // Bearer check: whoever holds the claim_key preimage can authorize
        // the claim. The claim_key was encrypted into recipient_blob at
        // send time, so in practice only the intended recipient (or admin)
        // can recover it. Replaces the v3 `packet.recipient == claimer`
        // check, which we removed to hide the recipient address on chain.
        let computed_hash = hash::sha2_256(claim_key);
        assert!(
            computed_hash == packet.claim_key_hash,
            error::permission_denied(E_INVALID_SECRET)
        );

        let now = block::get_current_block_height();
        assert!(now <= packet.expires_at, error::invalid_state(E_PACKET_EXPIRED));

        // Transfer
        let pool_signer = object::generate_signer_for_extending(&d.extend_ref);
        primary_fungible_store::transfer(&pool_signer, d.iusd_fa, recipient_addr, packet.amount);

        packet.claimed_slots = 1;
        packet.status = STATUS_COMPLETED;

        event::emit(GiftClaimedEvent {
            pool: pool_addr, packet_id,
            slot_index: 0, claimed_by: recipient_addr, amount: packet.amount,
        });
    }

    // ====================================================================
    // RECIPIENT: CLAIM SLOT (mode B - group)
    // ====================================================================

    /// Claim a group gift slot.
    /// slot_secret = SHA256(claim_key || le_bytes(slot_index))
    /// proof = SHA256(slot_secret || claimer_address)
    /// Contract verifies:
    ///   1. SHA256(slot_secret) == stored slot_hashes[slot_index]
    ///   2. SHA256(slot_secret || msg.sender) == proof
    public entry fun claim_slot(
        claimer: &signer,
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
        slot_index: u64,
        slot_secret: vector<u8>,
        proof: vector<u8>,
    ) acquires GiftPoolV3 {
        let claimer_addr = signer::address_of(claimer);
        claim_slot_internal(pool, packet_id, slot_index, slot_secret, proof, claimer_addr);
    }

    /// Sponsor claims group slot on behalf of recipient.
    public entry fun sponsor_claim_slot(
        sponsor: &signer,
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
        slot_index: u64,
        slot_secret: vector<u8>,
        proof: vector<u8>,
        recipient: address,
    ) acquires GiftPoolV3 {
        assert_sponsor(pool, signer::address_of(sponsor));
        claim_slot_internal(pool, packet_id, slot_index, slot_secret, proof, recipient);
    }

    fun claim_slot_internal(
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
        slot_index: u64,
        slot_secret: vector<u8>,
        proof: vector<u8>,
        recipient_addr: address,
    ) acquires GiftPoolV3 {
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPoolV3>(pool_addr);
        let packet = table::borrow_mut(&mut d.packets, packet_id);

        assert!(packet.mode == MODE_GROUP, error::invalid_argument(E_WRONG_MODE));
        assert!(packet.status == STATUS_ACTIVE, error::invalid_state(E_SLOT_NOT_OPEN));
        assert!(slot_index < packet.total_slots, error::out_of_range(E_SLOT_OUT_OF_RANGE));

        let now = block::get_current_block_height();
        assert!(now <= packet.expires_at, error::invalid_state(E_PACKET_EXPIRED));

        let slot = vector::borrow_mut(&mut packet.slots, slot_index);
        assert!(slot.status == SLOT_OPEN, error::invalid_state(E_SLOT_NOT_OPEN));

        // -- Verify secret --
        // slot_hash = SHA256(slot_secret) must match stored verify hash
        let secret_hash = hash::sha2_256(slot_secret);
        let stored_hash = vector::borrow(&packet.slot_hashes, slot_index);
        assert!(secret_hash == *stored_hash, error::permission_denied(E_INVALID_SECRET));

        // -- Verify address-bound proof (MEV protection) --
        // proof must equal SHA256(slot_secret || recipient_address)
        let mut_proof_input = slot_secret;
        let addr_bytes = std::bcs::to_bytes(&recipient_addr);
        vector::append(&mut mut_proof_input, addr_bytes);
        let expected_proof = hash::sha2_256(mut_proof_input);
        assert!(expected_proof == proof, error::permission_denied(E_INVALID_PROOF));

        // -- Transfer --
        let amount = slot.amount;
        if (amount > 0) {
            let pool_signer = object::generate_signer_for_extending(&d.extend_ref);
            primary_fungible_store::transfer(&pool_signer, d.iusd_fa, recipient_addr, amount);
        };

        slot.status = SLOT_CLAIMED;
        slot.claimed_by = recipient_addr;
        slot.claimed_at = now;
        packet.claimed_slots = packet.claimed_slots + 1;

        // Check if fully claimed
        if (packet.claimed_slots == packet.total_slots) {
            packet.status = STATUS_COMPLETED;
        };

        event::emit(GiftClaimedEvent {
            pool: pool_addr, packet_id,
            slot_index, claimed_by: recipient_addr, amount,
        });
    }

    // ====================================================================
    // RELAYER: EXPIRE AND REFUND
    // ====================================================================

    /// Expire a gift and refund unclaimed amounts to sender.
    /// Can only be called by a sponsor (relayer) after the gift has expired.
    /// One TX handles the entire refund - contract does all the work.
    public entry fun expire_and_refund(
        sponsor: &signer,
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
    ) acquires GiftPoolV3 {
        assert_sponsor(pool, signer::address_of(sponsor));

        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPoolV3>(pool_addr);

        assert!(table::contains(&d.packets, packet_id), error::not_found(E_PACKET_NOT_FOUND));
        let packet = table::borrow_mut(&mut d.packets, packet_id);
        assert!(packet.status == STATUS_ACTIVE, error::invalid_state(E_SLOT_NOT_OPEN));

        let now = block::get_current_block_height();
        assert!(now > packet.expires_at, error::invalid_state(E_PACKET_NOT_EXPIRED));

        let refund_amount: u64 = 0;
        let unclaimed: u64 = 0;

        if (packet.mode == MODE_DIRECT) {
            // Direct gift not claimed -> refund full amount
            if (packet.claimed_slots == 0) {
                refund_amount = packet.amount;
                unclaimed = 1;
            };
        } else {
            // Group gift -> iterate slots, refund OPEN ones
            let i = 0;
            let len = vector::length(&packet.slots);
            while (i < len) {
                let slot = vector::borrow_mut(&mut packet.slots, i);
                if (slot.status == SLOT_OPEN) {
                    refund_amount = refund_amount + slot.amount;
                    unclaimed = unclaimed + 1;
                    slot.status = SLOT_EXPIRED;
                };
                i = i + 1;
            };
        };

        // Transfer refund to sender
        if (refund_amount > 0) {
            let pool_signer = object::generate_signer_for_extending(&d.extend_ref);
            primary_fungible_store::transfer(&pool_signer, d.iusd_fa, packet.sender, refund_amount);
        };

        packet.status = STATUS_EXPIRED;

        event::emit(GiftExpiredEvent {
            pool: pool_addr, packet_id,
            sender: packet.sender,
            refund_amount, unclaimed_slots: unclaimed,
        });
    }

    // ====================================================================
    // INTERNAL HELPERS
    // ====================================================================

    /// Assert caller is an owner (original or added)
    fun assert_owner(pool: Object<GiftPoolV3>, caller: address) acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        assert!(
            caller == d.owner || (table::contains(&d.owners, caller) && *table::borrow(&d.owners, caller)),
            error::permission_denied(E_NOT_AUTHORIZED)
        );
    }

    /// Assert caller is an active sponsor
    fun assert_sponsor(pool: Object<GiftPoolV3>, caller: address) acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        assert!(
            table::contains(&d.sponsors, caller) && *table::borrow(&d.sponsors, caller),
            error::permission_denied(E_NOT_SPONSOR)
        );
    }

    /// Compute fee: min(amount * fee_bps / 10000, amount)
    fun compute_fee(amount: u64, fee_bps: u64): u64 {
        if (fee_bps == 0) return 0;
        let fee = (amount * fee_bps) / 10000;
        fee
    }

    /// Deterministic bounded-random allocation of total_amount into num_slots.
    /// Each slot gets between avg*50% and avg*150% (constrained random).
    /// Algorithm is public (on-chain), results depend on secret allocation_seed.
    /// Last slot gets remainder, guaranteed to be within bounds by construction.
    fun allocate_slots(
        total_amount: u64,
        num_slots: u64,
        seed: &vector<u8>,
    ): vector<GiftSlot> {
        let slots = vector::empty<GiftSlot>();
        let remaining = total_amount;
        let i: u64 = 0;

        // Average per slot
        let avg = total_amount / num_slots;

        // Bounded range: [avg/2, avg*3/2], but at least MIN_SLOT_SHARE
        let bound_min = if (avg / 2 > MIN_SLOT_SHARE) { avg / 2 } else { MIN_SLOT_SHARE };
        let bound_max = avg + avg / 2;  // avg * 1.5

        while (i < num_slots) {
            let slot_amount = if (i == num_slots - 1) {
                // Last slot gets remainder
                remaining
            } else {
                let slots_left = num_slots - i;

                // Ensure we can still give bound_min to remaining slots
                let min_reserved = (slots_left - 1) * bound_min;
                let effective_max = if (remaining > min_reserved + bound_min) {
                    let m = remaining - min_reserved;
                    if (m > bound_max) { bound_max } else { m }
                } else {
                    bound_min
                };

                let effective_min = if (remaining > min_reserved + effective_max) {
                    bound_min
                } else if (remaining > min_reserved) {
                    bound_min
                } else {
                    MIN_SLOT_SHARE
                };

                // Hash seed + index for randomness
                let hash_input = *seed;
                let idx_bytes = std::bcs::to_bytes(&i);
                vector::append(&mut hash_input, idx_bytes);
                let h = hash::sha2_256(hash_input);

                let rand_val = bytes_to_u64(&h);
                let range = if (effective_max > effective_min) {
                    effective_max - effective_min
                } else {
                    0
                };

                let share = if (range > 0) {
                    effective_min + (rand_val % range)
                } else {
                    effective_min
                };

                remaining = remaining - share;
                share
            };

            vector::push_back(&mut slots, GiftSlot {
                amount: slot_amount,
                status: SLOT_OPEN,
                claimed_by: @0x0,
                claimed_at: 0,
            });
            i = i + 1;
        };

        slots
    }

    /// Equal allocation of total_amount into num_slots.
    /// Each slot gets floor(total_amount / num_slots), last slot gets remainder.
    fun allocate_slots_equal(
        total_amount: u64,
        num_slots: u64,
    ): vector<GiftSlot> {
        let slots = vector::empty<GiftSlot>();
        let per_slot = total_amount / num_slots;
        let remaining = total_amount;
        let i: u64 = 0;

        while (i < num_slots) {
            let slot_amount = if (i == num_slots - 1) {
                remaining
            } else {
                per_slot
            };
            remaining = remaining - slot_amount;

            vector::push_back(&mut slots, GiftSlot {
                amount: slot_amount,
                status: SLOT_OPEN,
                claimed_by: @0x0,
                claimed_at: 0,
            });
            i = i + 1;
        };

        slots
    }

    /// Convert first 8 bytes of hash to u64
    fun bytes_to_u64(bytes: &vector<u8>): u64 {
        let result: u64 = 0;
        let i = 0;
        while (i < 8 && i < vector::length(bytes)) {
            result = (result << 8) | (*vector::borrow(bytes, i) as u64);
            i = i + 1;
        };
        result
    }

    // ====================================================================
    // VIEW FUNCTIONS
    // ====================================================================

    /// Get all registered box IDs (for frontend to iterate)
    #[view]
    public fun get_box_ids(
        pool: Object<GiftPoolV3>,
    ): vector<u64> acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        d.box_ids
    }

    /// Get box definition by ID
    #[view]
    public fun get_box(
        pool: Object<GiftPoolV3>,
        box_id: u64,
    ): (u64, String, u64, u64, vector<String>, bool) acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        assert!(table::contains(&d.boxes, box_id), error::not_found(E_BOX_NOT_FOUND));
        let b = table::borrow(&d.boxes, box_id);
        (b.box_id, b.name, b.amount, b.fee_bps, b.urls, b.enabled)
    }

    /// Check if a box is listed (enabled) for the shop
    #[view]
    public fun is_box_listed(
        pool: Object<GiftPoolV3>,
        box_id: u64,
    ): bool acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        assert!(table::contains(&d.boxes, box_id), error::not_found(E_BOX_NOT_FOUND));
        table::borrow(&d.boxes, box_id).enabled
    }

    /// Get box count
    #[view]
    public fun get_box_count(
        pool: Object<GiftPoolV3>,
    ): u64 acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        vector::length(&d.box_ids)
    }

    /// Get packet overview (does not reveal unclaimed slot amounts).
    /// Returns recipient_blob (opaque ciphertext) instead of a recipient
    /// address; resolution of the real recipient identity requires
    /// decrypting the blob with either the recipient's viewing_sk or the
    /// admin viewing_sk.
    #[view]
    public fun get_packet(
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
    ): (vector<u8>, u64, address, u8, vector<u8>, u64, u64, u64, u64, u8, u64, u64)
    acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        assert!(table::contains(&d.packets, packet_id), error::not_found(E_PACKET_NOT_FOUND));
        let p = table::borrow(&d.packets, packet_id);
        (p.packet_id, p.box_id, p.sender, p.mode, p.recipient_blob,
         p.amount, p.total_slots, p.claimed_slots, p.fee,
         p.status, p.created_at, p.expires_at)
    }

    /// Get the recipient_blob + claim_key_hash for a Direct-mode packet.
    /// Returns empty vectors for GROUP mode. Used by backend during the
    /// claim flow to recover claim_key via ECIES decryption.
    #[view]
    public fun get_recipient_blob(
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
    ): (vector<u8>, vector<u8>)
    acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        assert!(table::contains(&d.packets, packet_id), error::not_found(E_PACKET_NOT_FOUND));
        let p = table::borrow(&d.packets, packet_id);
        (p.recipient_blob, p.claim_key_hash)
    }

    /// Get slot info. Hides amount if not yet claimed.
    #[view]
    public fun get_slot(
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
        slot_index: u64,
    ): (u64, u8, address, u64) acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        assert!(table::contains(&d.packets, packet_id), error::not_found(E_PACKET_NOT_FOUND));
        let p = table::borrow(&d.packets, packet_id);
        assert!(slot_index < vector::length(&p.slots), error::out_of_range(E_SLOT_OUT_OF_RANGE));
        let s = vector::borrow(&p.slots, slot_index);

        // Hide amount for unclaimed slots
        let visible_amount = if (s.status == SLOT_CLAIMED || s.status == SLOT_EXPIRED) {
            s.amount
        } else {
            0  // hidden until claimed
        };
        (visible_amount, s.status, s.claimed_by, s.claimed_at)
    }

    /// Get all slots summary for a packet
    #[view]
    public fun get_slots_summary(
        pool: Object<GiftPoolV3>,
        packet_id: vector<u8>,
    ): (vector<u8>, vector<address>, vector<u64>) acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        assert!(table::contains(&d.packets, packet_id), error::not_found(E_PACKET_NOT_FOUND));
        let p = table::borrow(&d.packets, packet_id);

        let statuses = vector::empty<u8>();
        let claimers = vector::empty<address>();
        let amounts = vector::empty<u64>();
        let i = 0;
        let len = vector::length(&p.slots);
        while (i < len) {
            let s = vector::borrow(&p.slots, i);
            vector::push_back(&mut statuses, s.status);
            vector::push_back(&mut claimers, s.claimed_by);
            // Hide unclaimed amounts
            let visible = if (s.status != SLOT_OPEN) { s.amount } else { 0 };
            vector::push_back(&mut amounts, visible);
            i = i + 1;
        };
        (statuses, claimers, amounts)
    }

    /// Pool stats
    #[view]
    public fun get_pool_stats(
        pool: Object<GiftPoolV3>,
    ): (address, address, u64, u64, u64, u64) acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        (d.owner, d.treasury, d.cap, d.total_gifts, d.total_volume, d.total_fees)
    }

    /// Pool config
    #[view]
    public fun get_pool_config(
        pool: Object<GiftPoolV3>,
    ): (address, address, u64) acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        (d.owner, d.treasury, d.cap)
    }

    /// Check if address is an owner
    #[view]
    public fun is_owner(
        pool: Object<GiftPoolV3>,
        addr: address,
    ): bool acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        addr == d.owner || (table::contains(&d.owners, addr) && *table::borrow(&d.owners, addr))
    }

    /// Check if address is a sponsor
    #[view]
    public fun is_sponsor(
        pool: Object<GiftPoolV3>,
        addr: address,
    ): bool acquires GiftPoolV3 {
        let d = borrow_global<GiftPoolV3>(object::object_address(&pool));
        table::contains(&d.sponsors, addr) && *table::borrow(&d.sponsors, addr)
    }
}
