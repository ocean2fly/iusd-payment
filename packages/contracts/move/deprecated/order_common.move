/// iPay Order Common - Shared constants, types, and utilities
/// 
/// All order types share these definitions for consistency.
module ipay::order_common {
    use std::error;
    use std::vector;
    use initia_std::block;
    use initia_std::hash;

    // ============================================
    // ORDER TYPES
    // ============================================
    
    const ORDER_TYPE_SEND: u8 = 1;
    const ORDER_TYPE_REQUEST: u8 = 2;
    const ORDER_TYPE_SUBSCRIPTION: u8 = 3;
    const ORDER_TYPE_GIFT: u8 = 4;
    const ORDER_TYPE_MULTI_APPROVAL: u8 = 5;

    // ============================================
    // SHARED STATUS CODES (Send Order)
    // ============================================
    
    const STATUS_CREATED: u8 = 0;
    const STATUS_PROCESSING: u8 = 1;
    const STATUS_PENDING_CLAIM: u8 = 2;
    const STATUS_CONFIRMED: u8 = 3;
    const STATUS_REJECTED: u8 = 4;
    const STATUS_REVOKED: u8 = 5;
    const STATUS_REFUNDED: u8 = 6;
    const STATUS_EXPIRED: u8 = 7;
    const STATUS_INTERVENED: u8 = 99;

    // ============================================
    // ERROR CODES
    // ============================================
    
    const E_INVALID_STATUS: u64 = 1;
    const E_INVALID_TRANSITION: u64 = 2;
    const E_ORDER_NOT_FOUND: u64 = 3;
    const E_ORDER_EXPIRED: u64 = 4;
    const E_NOT_AUTHORIZED: u64 = 5;
    const E_INVALID_AMOUNT: u64 = 6;
    const E_INVALID_KEY: u64 = 7;
    const E_ALREADY_EXISTS: u64 = 8;

    // ============================================
    // STRUCTS
    // ============================================

    /// Order summary for list queries
    struct OrderSummary has copy, drop, store {
        id: vector<u8>,
        order_type: u8,
        status: u8,
        created_at: u64,
        expires_at: u64,
        is_dummy: bool,  // For obfuscation
    }

    /// User settings (stored per user)
    struct UserSettings has key, store {
        auto_claim: bool,
        viewing_pubkey: vector<u8>,  // 33 bytes compressed secp256k1
    }

    // ============================================
    // PUBLIC GETTERS
    // ============================================

    public fun order_type_send(): u8 { ORDER_TYPE_SEND }
    public fun order_type_request(): u8 { ORDER_TYPE_REQUEST }
    public fun order_type_subscription(): u8 { ORDER_TYPE_SUBSCRIPTION }
    public fun order_type_gift(): u8 { ORDER_TYPE_GIFT }
    public fun order_type_multi_approval(): u8 { ORDER_TYPE_MULTI_APPROVAL }

    public fun status_created(): u8 { STATUS_CREATED }
    public fun status_processing(): u8 { STATUS_PROCESSING }
    public fun status_pending_claim(): u8 { STATUS_PENDING_CLAIM }
    public fun status_confirmed(): u8 { STATUS_CONFIRMED }
    public fun status_rejected(): u8 { STATUS_REJECTED }
    public fun status_revoked(): u8 { STATUS_REVOKED }
    public fun status_refunded(): u8 { STATUS_REFUNDED }
    public fun status_expired(): u8 { STATUS_EXPIRED }
    public fun status_intervened(): u8 { STATUS_INTERVENED }

    public fun e_invalid_status(): u64 { E_INVALID_STATUS }
    public fun e_invalid_transition(): u64 { E_INVALID_TRANSITION }
    public fun e_order_not_found(): u64 { E_ORDER_NOT_FOUND }
    public fun e_order_expired(): u64 { E_ORDER_EXPIRED }
    public fun e_not_authorized(): u64 { E_NOT_AUTHORIZED }
    public fun e_invalid_amount(): u64 { E_INVALID_AMOUNT }
    public fun e_invalid_key(): u64 { E_INVALID_KEY }
    public fun e_already_exists(): u64 { E_ALREADY_EXISTS }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    /// Check if order is expired
    public fun is_expired(expires_at: u64): bool {
        let (_, now) = block::get_block_info();
        now >= expires_at
    }

    /// Check if order is NOT expired
    public fun check_not_expired(expires_at: u64) {
        assert!(!is_expired(expires_at), error::invalid_state(E_ORDER_EXPIRED));
    }

    /// Validate amount is within bounds
    public fun validate_amount(amount: u64, min: u64, max: u64): bool {
        amount >= min && amount <= max
    }

    /// Generate cooked address for inbox indexing
    /// cooked_address = SHA256(viewing_pubkey || "ipay_inbox_v1")
    public fun compute_cooked_address(viewing_pubkey: &vector<u8>): vector<u8> {
        let preimage = *viewing_pubkey;
        vector::append(&mut preimage, b"ipay_inbox_v1");
        hash::sha2_256(preimage)
    }

    /// Check if status is terminal (no outbound transitions except intervene)
    public fun is_terminal_status(status: u8): bool {
        status == STATUS_CONFIRMED ||
        status == STATUS_REJECTED ||
        status == STATUS_REVOKED ||
        status == STATUS_REFUNDED ||
        status == STATUS_EXPIRED ||
        status == STATUS_INTERVENED
    }

    /// Create an OrderSummary
    public fun new_order_summary(
        id: vector<u8>,
        order_type: u8,
        status: u8,
        created_at: u64,
        expires_at: u64,
        is_dummy: bool,
    ): OrderSummary {
        OrderSummary {
            id,
            order_type,
            status,
            created_at,
            expires_at,
            is_dummy,
        }
    }

    // ============================================
    // OBFUSCATION HELPERS
    // ============================================

    /// Generate a dummy order ID based on seed
    public fun generate_dummy_id(seed: u64, user_addr: address): vector<u8> {
        let preimage = std::bcs::to_bytes(&seed);
        vector::append(&mut preimage, std::bcs::to_bytes(&user_addr));
        vector::append(&mut preimage, b"ipay_dummy");
        hash::sha2_256(preimage)
    }
}
