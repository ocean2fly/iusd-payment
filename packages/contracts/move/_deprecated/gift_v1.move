/// iPay Gift V1 - Red Envelope / Gift Box Payment
///
/// Admin configures gift types on-chain (gift_id -> amount + box_fee).
/// Users send gifts by calling send_gift() which:
///   1. Validates gift_id exists and is enabled
///   2. Transfers (amount + box_fee) from sender
///   3. box_fee -> treasury (platform revenue)
///   4. amount -> locked in N slots for recipients to claim
///   5. Free gifts: checks per-user cooldown window
///
/// Recipients claim via sponsor_claim_slot() (gasless, relayer pays gas).
/// Unclaimed slots can be refunded after expiry.
module ipay::gift_v1 {
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

    const SLOT_OPEN:    u8 = 0;
    const SLOT_CLAIMED: u8 = 1;
    const SLOT_EXPIRED: u8 = 2;

    const TIER_FREE:      u8 = 0;
    const TIER_CLASSIC:   u8 = 1;
    const TIER_RARE:      u8 = 2;
    const TIER_LEGENDARY: u8 = 3;

    const DEFAULT_TTL: u64 = 7 * 24 * 60 * 60;  // ~7 days in blocks
    const MAX_SLOTS:   u64 = 50;
    const MIN_SLOT_AMOUNT: u64 = 1_000;          // 0.001 iUSD minimum per slot

    const E_NOT_AUTHORIZED:      u64 = 300;
    const E_NOT_SPONSOR:         u64 = 301;
    const E_GIFT_NOT_FOUND:      u64 = 302;
    const E_GIFT_DISABLED:       u64 = 303;
    const E_COOLDOWN_NOT_EXPIRED: u64 = 304;
    const E_AMOUNT_MISMATCH:     u64 = 305;
    const E_TOO_MANY_SLOTS:      u64 = 306;
    const E_MISMATCHED_VECTORS:  u64 = 307;
    const E_SLOT_NOT_FOUND:      u64 = 308;
    const E_SLOT_NOT_OPEN:       u64 = 309;
    const E_INVALID_KEY:         u64 = 310;
    const E_WRONG_CLAIMER:       u64 = 311;
    const E_PACKET_EXPIRED:      u64 = 312;
    const E_PACKET_NOT_EXPIRED:  u64 = 313;
    const E_NOT_SENDER:          u64 = 314;
    const E_DUPLICATE_PACKET:    u64 = 315;
    const E_MIN_SLOT_AMOUNT:     u64 = 316;

    // ============================================
    // STRUCTS
    // ============================================

    /// Admin-configured gift type. Stored on-chain, single source of truth.
    struct GiftDef has store, drop, copy {
        gift_id:         u64,
        amount:          u64,   // total face value in uiUSD (0 = free gift)
        box_fee:         u64,   // service fee in uiUSD -> treasury (0 for free)
        tier:            u8,    // TIER_FREE/CLASSIC/RARE/LEGENDARY
        cooldown_blocks: u64,   // 0 = no limit; >0 = free gift cooldown window
        enabled:         bool,
    }

    /// One recipient slot inside a GiftPacket
    struct GiftSlot has store, drop, copy {
        slot_id:         vector<u8>,
        share_amount:    u64,
        claim_key_hash:  vector<u8>,   // SHA3-256(claim_key)
        allowed_claimer: address,      // @0x0 = anyone; address = named recipient
        status:          u8,
        claimed_by:      address,
        claimed_at:      u64,
    }

    /// A sent gift packet (red envelope)
    struct GiftPacket has store {
        packet_id:     vector<u8>,
        gift_id:       u64,
        gift_amount:   u64,       // snapshot of GiftDef.amount at send time
        total_slots:   u64,
        claimed_slots: u64,
        slots:         Table<vector<u8>, GiftSlot>,
        slot_ids:      vector<vector<u8>>,
        sender:        address,
        created_at:    u64,
        expires_at:    u64,
    }

    /// Pool object - holds iUSD for pending claims
    struct GiftPool has key {
        extend_ref: ExtendRef,
        iusd_fa:    Object<Metadata>,
        owner:      address,
        treasury:   address,

        // Gift type registry (admin-managed)
        gifts:      Table<u64, GiftDef>,

        // Free gift cooldown tracking: user -> gift_id -> last_used_block
        cooldowns:  Table<address, Table<u64, u64>>,

        // Active/completed gift packets
        packets:    Table<vector<u8>, GiftPacket>,

        // Authorized relayers for gasless claims
        sponsors:   Table<address, bool>,

        // Stats
        total_sent:   u64,
        total_volume: u64,
        total_fees:   u64,
    }

    // ============================================
    // EVENTS
    // ============================================

    #[event]
    struct GiftDefSetEvent has drop, store {
        pool:            address,
        gift_id:         u64,
        amount:          u64,
        box_fee:         u64,
        tier:            u8,
        cooldown_blocks: u64,
        enabled:         bool,
    }

    #[event]
    struct GiftSentEvent has drop, store {
        pool:        address,
        packet_id:   vector<u8>,
        sender:      address,
        gift_id:     u64,
        total_slots: u64,
        amount:      u64,
        box_fee:     u64,
        expires_at:  u64,
    }

    #[event]
    struct GiftClaimedEvent has drop, store {
        pool:       address,
        packet_id:  vector<u8>,
        slot_id:    vector<u8>,
        claimed_by: address,
        amount:     u64,
    }

    #[event]
    struct GiftRefundedEvent has drop, store {
        pool:            address,
        packet_id:       vector<u8>,
        sender:          address,
        refund_amount:   u64,
        unclaimed_slots: u64,
    }

    // ============================================
    // POOL CREATION (called by factory)
    // ============================================

    public fun create_pool(
        owner: &signer,
        iusd_fa: Object<Metadata>,
    ): Object<GiftPool> {
        let owner_addr = signer::address_of(owner);
        let constructor_ref = object::create_object(owner_addr, false);
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let object_signer = object::generate_signer(&constructor_ref);
        move_to(&object_signer, GiftPool {
            extend_ref,
            iusd_fa,
            owner:        owner_addr,
            treasury:     owner_addr,
            gifts:        table::new(),
            cooldowns:    table::new(),
            packets:      table::new(),
            sponsors:     table::new(),
            total_sent:   0,
            total_volume: 0,
            total_fees:   0,
        });
        object::object_from_constructor_ref<GiftPool>(&constructor_ref)
    }

    // ============================================
    // ADMIN: SPONSOR MANAGEMENT
    // ============================================

    public entry fun add_sponsor(
        owner: &signer,
        pool: Object<GiftPool>,
        sponsor: address,
    ) acquires GiftPool {
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPool>(pool_addr);
        assert!(signer::address_of(owner) == d.owner, error::permission_denied(E_NOT_AUTHORIZED));
        if (!table::contains(&d.sponsors, sponsor)) {
            table::add(&mut d.sponsors, sponsor, true);
        } else {
            *table::borrow_mut(&mut d.sponsors, sponsor) = true;
        };
    }

    public entry fun remove_sponsor(
        owner: &signer,
        pool: Object<GiftPool>,
        sponsor: address,
    ) acquires GiftPool {
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPool>(pool_addr);
        assert!(signer::address_of(owner) == d.owner, error::permission_denied(E_NOT_AUTHORIZED));
        if (table::contains(&d.sponsors, sponsor)) {
            *table::borrow_mut(&mut d.sponsors, sponsor) = false;
        };
    }

    public entry fun set_treasury(
        owner: &signer,
        pool: Object<GiftPool>,
        new_treasury: address,
    ) acquires GiftPool {
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPool>(pool_addr);
        assert!(signer::address_of(owner) == d.owner, error::permission_denied(E_NOT_AUTHORIZED));
        d.treasury = new_treasury;
    }

    // ============================================
    // ADMIN: GIFT TYPE CONFIGURATION
    // ============================================

    /// Register or update a gift type. This is the on-chain source of truth.
    /// API calls this after saving to DB.
    public entry fun admin_set_gift(
        admin: &signer,
        pool: Object<GiftPool>,
        gift_id: u64,
        amount: u64,
        box_fee: u64,
        tier: u8,
        cooldown_blocks: u64,
        enabled: bool,
    ) acquires GiftPool {
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPool>(pool_addr);
        assert!(signer::address_of(admin) == d.owner, error::permission_denied(E_NOT_AUTHORIZED));

        let def = GiftDef { gift_id, amount, box_fee, tier, cooldown_blocks, enabled };

        if (!table::contains(&d.gifts, gift_id)) {
            table::add(&mut d.gifts, gift_id, def);
        } else {
            *table::borrow_mut(&mut d.gifts, gift_id) = def;
        };

        event::emit(GiftDefSetEvent {
            pool: pool_addr,
            gift_id, amount, box_fee, tier, cooldown_blocks, enabled,
        });
    }

    // ============================================
    // USER: SEND GIFT
    // ============================================

    /// Send a gift packet to N recipients.
    ///
    /// - gift_id must exist and be enabled
    /// - slot_amounts must sum to GiftDef.amount
    /// - Transfers (amount + box_fee) from sender
    /// - box_fee goes to treasury immediately
    /// - amount locked in pool for recipients to claim
    /// - Free gifts: checks + updates cooldown for sender
    public entry fun send_gift(
        sender: &signer,
        pool: Object<GiftPool>,
        gift_id: u64,
        packet_id: vector<u8>,
        slot_ids: vector<vector<u8>>,
        slot_amounts: vector<u64>,
        slot_claim_key_hashes: vector<vector<u8>>,
        allowed_claimers: vector<address>,
        ttl: u64,
    ) acquires GiftPool {
        let sender_addr = signer::address_of(sender);
        let n = vector::length(&slot_ids);

        // ---- Validate inputs ----
        assert!(n > 0 && (n as u64) <= MAX_SLOTS, error::invalid_argument(E_TOO_MANY_SLOTS));
        assert!(vector::length(&slot_amounts)          == n, error::invalid_argument(E_MISMATCHED_VECTORS));
        assert!(vector::length(&slot_claim_key_hashes) == n, error::invalid_argument(E_MISMATCHED_VECTORS));
        assert!(vector::length(&allowed_claimers)      == n, error::invalid_argument(E_MISMATCHED_VECTORS));

        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPool>(pool_addr);

        assert!(!table::contains(&d.packets, packet_id), error::already_exists(E_DUPLICATE_PACKET));

        // ---- Look up gift definition ----
        assert!(table::contains(&d.gifts, gift_id), error::not_found(E_GIFT_NOT_FOUND));
        let gift = *table::borrow(&d.gifts, gift_id);
        assert!(gift.enabled, error::invalid_state(E_GIFT_DISABLED));

        // ---- Verify slot amounts sum to gift.amount ----
        let sum: u64 = 0;
        let i = 0;
        while (i < n) {
            let amt = *vector::borrow(&slot_amounts, i);
            assert!(amt >= MIN_SLOT_AMOUNT, error::invalid_argument(E_MIN_SLOT_AMOUNT));
            sum = sum + amt;
            i = i + 1;
        };
        assert!(sum == gift.amount, error::invalid_argument(E_AMOUNT_MISMATCH));

        let now = block::get_current_block_height();

        // ---- Handle free gift cooldown ----
        if (gift.amount == 0) {
            if (gift.cooldown_blocks > 0) {
                if (!table::contains(&d.cooldowns, sender_addr)) {
                    table::add(&mut d.cooldowns, sender_addr, table::new());
                };
                let user_cd = table::borrow_mut(&mut d.cooldowns, sender_addr);
                if (table::contains(user_cd, gift_id)) {
                    let last_block = *table::borrow(user_cd, gift_id);
                    assert!(
                        now >= last_block + gift.cooldown_blocks,
                        error::invalid_state(E_COOLDOWN_NOT_EXPIRED)
                    );
                    *table::borrow_mut(user_cd, gift_id) = now;
                } else {
                    table::add(user_cd, gift_id, now);
                };
            }
            // Free gift: no iUSD transfer
        } else {
            // ---- Paid gift: transfer amount + box_fee from sender ----
            let pool_signer = object::generate_signer_for_extending(&d.extend_ref);
            primary_fungible_store::transfer(sender, d.iusd_fa, pool_addr, gift.amount + gift.box_fee);
            // Immediately route box_fee to treasury
            if (gift.box_fee > 0) {
                primary_fungible_store::transfer(&pool_signer, d.iusd_fa, d.treasury, gift.box_fee);
            };
            d.total_volume = d.total_volume + gift.amount;
            d.total_fees   = d.total_fees   + gift.box_fee;
        };

        // ---- Build packet ----
        let ttl_val = if (ttl > 0) { ttl } else { DEFAULT_TTL };

        let packet = GiftPacket {
            packet_id,
            gift_id,
            gift_amount:   gift.amount,
            total_slots:   (n as u64),
            claimed_slots: 0,
            slots:         table::new(),
            slot_ids:      vector::empty(),
            sender:        sender_addr,
            created_at:    now,
            expires_at:    now + ttl_val,
        };

        // ---- Populate slots ----
        let j = 0;
        while (j < n) {
            let sid   = *vector::borrow(&slot_ids, j);
            let amt   = *vector::borrow(&slot_amounts, j);
            let khash = *vector::borrow(&slot_claim_key_hashes, j);
            let acl   = *vector::borrow(&allowed_claimers, j);
            let slot = GiftSlot {
                slot_id:         sid,
                share_amount:    amt,
                claim_key_hash:  khash,
                allowed_claimer: acl,
                status:          SLOT_OPEN,
                claimed_by:      @0x0,
                claimed_at:      0,
            };
            vector::push_back(&mut packet.slot_ids, sid);
            table::add(&mut packet.slots, sid, slot);
            j = j + 1;
        };

        table::add(&mut d.packets, packet_id, packet);
        d.total_sent = d.total_sent + 1;

        event::emit(GiftSentEvent {
            pool:        pool_addr,
            packet_id,
            sender:      sender_addr,
            gift_id,
            total_slots: (n as u64),
            amount:      gift.amount,
            box_fee:     gift.box_fee,
            expires_at:  now + ttl_val,
        });
    }

    // ============================================
    // RECIPIENT: CLAIM SLOT
    // ============================================

    /// Claim a specific slot. Transfers share_amount to msg.sender.
    public entry fun claim_slot(
        claimer: &signer,
        pool: Object<GiftPool>,
        packet_id: vector<u8>,
        slot_id: vector<u8>,
        slot_claim_key: vector<u8>,
    ) acquires GiftPool {
        claim_internal(pool, packet_id, slot_id, slot_claim_key, signer::address_of(claimer));
    }

    /// Relayer (sponsor) claims on behalf of recipient - gasless for recipient.
    public entry fun sponsor_claim_slot(
        sponsor: &signer,
        pool: Object<GiftPool>,
        packet_id: vector<u8>,
        slot_id: vector<u8>,
        slot_claim_key: vector<u8>,
        recipient: address,
    ) acquires GiftPool {
        let pool_addr = object::object_address(&pool);
        let d = borrow_global<GiftPool>(pool_addr);
        let sp = signer::address_of(sponsor);
        assert!(
            table::contains(&d.sponsors, sp) && *table::borrow(&d.sponsors, sp),
            error::permission_denied(E_NOT_SPONSOR)
        );
        claim_internal(pool, packet_id, slot_id, slot_claim_key, recipient);
    }

    fun claim_internal(
        pool: Object<GiftPool>,
        packet_id: vector<u8>,
        slot_id: vector<u8>,
        slot_claim_key: vector<u8>,
        recipient: address,
    ) acquires GiftPool {
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPool>(pool_addr);

        assert!(table::contains(&d.packets, packet_id), error::not_found(E_SLOT_NOT_FOUND));
        let packet = table::borrow_mut(&mut d.packets, packet_id);

        let now = block::get_current_block_height();
        assert!(now <= packet.expires_at, error::invalid_state(E_PACKET_EXPIRED));

        assert!(table::contains(&packet.slots, slot_id), error::not_found(E_SLOT_NOT_FOUND));
        let slot = table::borrow_mut(&mut packet.slots, slot_id);

        assert!(slot.status == SLOT_OPEN, error::invalid_state(E_SLOT_NOT_OPEN));

        // Verify claim key
        let key_hash = hash::sha2_256(slot_claim_key);
        assert!(key_hash == slot.claim_key_hash, error::permission_denied(E_INVALID_KEY));

        // Named recipient check
        if (slot.allowed_claimer != @0x0) {
            assert!(recipient == slot.allowed_claimer, error::permission_denied(E_WRONG_CLAIMER));
        };

        // Transfer funds (free gifts have share_amount == 0, skip transfer)
        if (slot.share_amount > 0) {
            let pool_signer = object::generate_signer_for_extending(&d.extend_ref);
            primary_fungible_store::transfer(&pool_signer, d.iusd_fa, recipient, slot.share_amount);
        };

        slot.status     = SLOT_CLAIMED;
        slot.claimed_by = recipient;
        slot.claimed_at = now;
        packet.claimed_slots = packet.claimed_slots + 1;

        event::emit(GiftClaimedEvent {
            pool: pool_addr,
            packet_id,
            slot_id,
            claimed_by: recipient,
            amount: slot.share_amount,
        });
    }

    // ============================================
    // SENDER: REFUND EXPIRED SLOTS
    // ============================================

    public entry fun refund_expired(
        sender: &signer,
        pool: Object<GiftPool>,
        packet_id: vector<u8>,
    ) acquires GiftPool {
        let sender_addr = signer::address_of(sender);
        let pool_addr = object::object_address(&pool);
        let d = borrow_global_mut<GiftPool>(pool_addr);

        assert!(table::contains(&d.packets, packet_id), error::not_found(E_SLOT_NOT_FOUND));
        let packet = table::borrow_mut(&mut d.packets, packet_id);
        assert!(packet.sender == sender_addr, error::permission_denied(E_NOT_SENDER));

        let now = block::get_current_block_height();
        assert!(now > packet.expires_at, error::invalid_state(E_PACKET_NOT_EXPIRED));

        let refund: u64 = 0;
        let unclaimed: u64 = 0;
        let sids = packet.slot_ids;
        let k = 0;
        let len = vector::length(&sids);
        while (k < len) {
            let sid = *vector::borrow(&sids, k);
            if (table::contains(&packet.slots, sid)) {
                let slot = table::borrow_mut(&mut packet.slots, sid);
                if (slot.status == SLOT_OPEN) {
                    refund    = refund + slot.share_amount;
                    unclaimed = unclaimed + 1;
                    slot.status = SLOT_EXPIRED;
                };
            };
            k = k + 1;
        };

        if (refund > 0) {
            let pool_signer = object::generate_signer_for_extending(&d.extend_ref);
            primary_fungible_store::transfer(&pool_signer, d.iusd_fa, sender_addr, refund);
        };

        event::emit(GiftRefundedEvent {
            pool: pool_addr,
            packet_id,
            sender: sender_addr,
            refund_amount: refund,
            unclaimed_slots: unclaimed,
        });
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    #[view]
    public fun get_gift_def(
        pool: Object<GiftPool>,
        gift_id: u64,
    ): (u64, u64, u64, u8, u64, bool)
    acquires GiftPool {
        let d = borrow_global<GiftPool>(object::object_address(&pool));
        assert!(table::contains(&d.gifts, gift_id), error::not_found(E_GIFT_NOT_FOUND));
        let g = table::borrow(&d.gifts, gift_id);
        (g.gift_id, g.amount, g.box_fee, g.tier, g.cooldown_blocks, g.enabled)
    }

    #[view]
    public fun get_packet(
        pool: Object<GiftPool>,
        packet_id: vector<u8>,
    ): (vector<u8>, u64, u64, u64, u64, address, u64, u64)
    acquires GiftPool {
        let d = borrow_global<GiftPool>(object::object_address(&pool));
        assert!(table::contains(&d.packets, packet_id), error::not_found(E_SLOT_NOT_FOUND));
        let p = table::borrow(&d.packets, packet_id);
        (p.packet_id, p.gift_id, p.gift_amount, p.total_slots, p.claimed_slots,
         p.sender, p.created_at, p.expires_at)
    }

    #[view]
    public fun get_slot(
        pool: Object<GiftPool>,
        packet_id: vector<u8>,
        slot_id: vector<u8>,
    ): (vector<u8>, u64, address, u8, address, u64)
    acquires GiftPool {
        let d = borrow_global<GiftPool>(object::object_address(&pool));
        assert!(table::contains(&d.packets, packet_id), error::not_found(E_SLOT_NOT_FOUND));
        let p = table::borrow(&d.packets, packet_id);
        assert!(table::contains(&p.slots, slot_id), error::not_found(E_SLOT_NOT_FOUND));
        let s = table::borrow(&p.slots, slot_id);
        (s.slot_id, s.share_amount, s.allowed_claimer, s.status, s.claimed_by, s.claimed_at)
    }

    #[view]
    public fun get_slot_ids(
        pool: Object<GiftPool>,
        packet_id: vector<u8>,
    ): vector<vector<u8>>
    acquires GiftPool {
        let d = borrow_global<GiftPool>(object::object_address(&pool));
        assert!(table::contains(&d.packets, packet_id), error::not_found(E_SLOT_NOT_FOUND));
        let p = table::borrow(&d.packets, packet_id);
        p.slot_ids
    }

    #[view]
    public fun get_cooldown_remaining(
        pool: Object<GiftPool>,
        user: address,
        gift_id: u64,
    ): u64  // 0 = no cooldown / cooldown expired; >0 = blocks remaining
    acquires GiftPool {
        let pool_addr = object::object_address(&pool);
        let d = borrow_global<GiftPool>(pool_addr);
        if (!table::contains(&d.gifts, gift_id)) return 0;
        let gift = table::borrow(&d.gifts, gift_id);
        if (gift.cooldown_blocks == 0) return 0;
        if (!table::contains(&d.cooldowns, user)) return 0;
        let user_cd = table::borrow(&d.cooldowns, user);
        if (!table::contains(user_cd, gift_id)) return 0;
        let last = *table::borrow(user_cd, gift_id);
        let now = block::get_current_block_height();
        let ready_at = last + gift.cooldown_blocks;
        if (now >= ready_at) 0 else ready_at - now
    }

    #[view]
    public fun get_pool_stats(
        pool: Object<GiftPool>,
    ): (address, address, u64, u64, u64)
    acquires GiftPool {
        let d = borrow_global<GiftPool>(object::object_address(&pool));
        (d.owner, d.treasury, d.total_sent, d.total_volume, d.total_fees)
    }
}
