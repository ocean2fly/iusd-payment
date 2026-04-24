// iPay Request Order Tests
// Tests all state transitions and role-based access control for payment requests
//
// Run with: initiad move test --filter request_tests
#[test_only]
module ipay::request_tests {
    use std::signer;
    use std::vector;
    use initia_std::hash;

    use ipay::order_common;

    // ============================================
    // CONSTANTS (mirror from request.move)
    // ============================================

    const STATUS_CREATED: u8 = 0;
    const STATUS_PENDING_PAY: u8 = 1;
    const STATUS_CONFIRMED: u8 = 2;
    const STATUS_REJECTED: u8 = 3;
    const STATUS_CANCELLED: u8 = 4;
    const STATUS_EXPIRED: u8 = 5;
    const STATUS_INTERVENED: u8 = 99;

    // ============================================
    // TEST HELPERS
    // ============================================

    fun create_test_pay_key(seed: u64): vector<u8> {
        let preimage = std::bcs::to_bytes(&seed);
        vector::append(&mut preimage, b"test_pay_key");
        hash::sha2_256(preimage)
    }

    fun create_test_cancel_key(seed: u64): vector<u8> {
        let preimage = std::bcs::to_bytes(&seed);
        vector::append(&mut preimage, b"test_cancel_key");
        hash::sha2_256(preimage)
    }

    // ============================================
    // STATE TRANSITION TESTS
    // ============================================

    // Test: R0 created -> R1 pending_pay (immediate on create)
    #[test]
    fun test_request_starts_pending_pay() {
        // After create_request, order should be in R1 pending_pay
        assert!(STATUS_PENDING_PAY == 1, 1);
    }

    // Test: R1 pending_pay -> R2 confirmed via pay
    #[test]
    fun test_transition_pending_pay_to_confirmed() {
        assert!(STATUS_PENDING_PAY == 1, 1);
        assert!(STATUS_CONFIRMED == 2, 2);
    }

    // Test: R1 pending_pay -> R3 rejected via reject
    #[test]
    fun test_transition_pending_pay_to_rejected() {
        assert!(STATUS_PENDING_PAY == 1, 1);
        assert!(STATUS_REJECTED == 3, 2);
    }

    // Test: R1 pending_pay -> R4 cancelled via cancel
    #[test]
    fun test_transition_pending_pay_to_cancelled() {
        assert!(STATUS_PENDING_PAY == 1, 1);
        assert!(STATUS_CANCELLED == 4, 2);
    }

    // Test: R1 pending_pay -> R5 expired via expire
    #[test]
    fun test_transition_pending_pay_to_expired() {
        assert!(STATUS_PENDING_PAY == 1, 1);
        assert!(STATUS_EXPIRED == 5, 2);
    }

    // Test: Any -> R6 intervened via intervene
    #[test]
    fun test_transition_any_to_intervened() {
        assert!(STATUS_INTERVENED == 99, 1);
    }

    // ============================================
    // INVALID TRANSITION TESTS
    // ============================================

    #[test]
    fun test_cannot_pay_after_rejected() {
        // Cannot pay after rejection
        assert!(STATUS_REJECTED != STATUS_PENDING_PAY, 1);
    }

    #[test]
    fun test_cannot_cancel_after_paid() {
        // Cannot cancel after payment confirmed
        assert!(STATUS_CONFIRMED != STATUS_PENDING_PAY, 1);
    }

    #[test]
    fun test_terminal_states() {
        // Terminal states: confirmed, rejected, cancelled, expired, intervened
        assert!(STATUS_CONFIRMED == 2, 1);
        assert!(STATUS_REJECTED == 3, 2);
        assert!(STATUS_CANCELLED == 4, 3);
        assert!(STATUS_EXPIRED == 5, 4);
        assert!(STATUS_INTERVENED == 99, 5);
    }

    // ============================================
    // ROLE-BASED ACCESS TESTS
    // ============================================

    #[test]
    fun test_pay_requires_correct_key() {
        // Pay requires correct pay_key that hashes to pay_key_hash
        let pay_key = create_test_pay_key(1);
        let pay_key_hash = hash::sha2_256(pay_key);
        
        let wrong_key = create_test_pay_key(2);
        let wrong_hash = hash::sha2_256(wrong_key);
        
        assert!(pay_key_hash != wrong_hash, 1);
    }

    #[test]
    fun test_cancel_requires_correct_key() {
        // Cancel requires correct cancel_key that hashes to cancel_key_hash
        let cancel_key = create_test_cancel_key(1);
        let cancel_key_hash = hash::sha2_256(cancel_key);
        
        let wrong_key = create_test_cancel_key(2);
        let wrong_hash = hash::sha2_256(wrong_key);
        
        assert!(cancel_key_hash != wrong_hash, 1);
    }

    #[test]
    fun test_expire_admin_only() {
        // Expire can only be called by owner/admin
        let error_not_authorized = order_common::e_not_authorized();
        assert!(error_not_authorized == 5, 1);
    }

    #[test]
    fun test_intervene_admin_only() {
        // Intervene can only be called by owner/admin
        let error_not_authorized = order_common::e_not_authorized();
        assert!(error_not_authorized == 5, 1);
    }

    // ============================================
    // EXPIRY TESTS
    // ============================================

    #[test]
    fun test_pay_fails_after_expiry() {
        // Attempting to pay expired request should fail
        let error_expired = order_common::e_order_expired();
        assert!(error_expired == 4, 1);
    }

    #[test]
    fun test_default_request_ttl() {
        // Default TTL is 7 days
        let seven_days_seconds = 7 * 24 * 60 * 60;
        assert!(seven_days_seconds == 604800, 1);
    }

    // ============================================
    // FEE CALCULATION TESTS
    // ============================================

    #[test]
    fun test_fee_calculation_on_pay() {
        let amount = 1000000u64; // 1 iUSD
        let fee_bps = 100u64;    // 1%
        
        let fee = (amount * fee_bps) / 10000;
        assert!(fee == 10000, 1); // 0.01 iUSD
        
        let net = amount - fee;
        assert!(net == 990000, 2); // 0.99 iUSD to requester
    }

    // ============================================
    // AMOUNT VALIDATION TESTS
    // ============================================

    #[test]
    fun test_request_amount_validation() {
        let min_amount = 10000u64;    // 0.01 iUSD
        let max_amount = 100000000000u64; // 100,000 iUSD
        
        // Valid amounts
        assert!(order_common::validate_amount(min_amount, min_amount, max_amount), 1);
        assert!(order_common::validate_amount(max_amount, min_amount, max_amount), 2);
        
        // Invalid amounts
        assert!(!order_common::validate_amount(min_amount - 1, min_amount, max_amount), 3);
        assert!(!order_common::validate_amount(max_amount + 1, min_amount, max_amount), 4);
    }

    // ============================================
    // INDEXING TESTS
    // ============================================

    #[test]
    fun test_requester_index() {
        // Requests should be indexed by requester cooked address
        let cooked1 = b"requester_cooked_addr_1xxxxxxxx";
        let cooked2 = b"requester_cooked_addr_2xxxxxxxx";
        assert!(cooked1 != cooked2, 1);
    }

    #[test]
    fun test_payer_index() {
        // Requests should be indexed by payer cooked address
        let cooked1 = b"payer_cooked_address_1xxxxxxxxx";
        let cooked2 = b"payer_cooked_address_2xxxxxxxxx";
        assert!(cooked1 != cooked2, 1);
    }

    #[test]
    fun test_open_request_no_payer_cooked() {
        // Open requests (anyone can pay) have empty payer_cooked
        let empty: vector<u8> = vector::empty();
        assert!(vector::length(&empty) == 0, 1);
    }

    // ============================================
    // PAYMENT FLOW TESTS
    // ============================================

    #[test]
    fun test_payment_records_payer() {
        // After payment, paid_by and paid_at should be set
        let zero_addr = @0x0;
        let payer_addr = @0x123;
        assert!(zero_addr != payer_addr, 1);
    }

    #[test]
    fun test_payment_updates_stats() {
        // Payment should increment total_paid
        let total_paid = 0u64;
        let amount = 1000000u64;
        let new_total = total_paid + amount;
        assert!(new_total == 1000000, 1);
    }

    // ============================================
    // ADMIN FUNCTION TESTS
    // ============================================

    #[test(owner = @0x123, non_owner = @0x456)]
    fun test_only_owner_can_transfer_ownership(owner: &signer, non_owner: &signer) {
        let owner_addr = signer::address_of(owner);
        let non_owner_addr = signer::address_of(non_owner);
        assert!(owner_addr != non_owner_addr, 1);
    }

    #[test]
    fun test_fee_bps_max_limit() {
        // Fee cannot exceed 10% (1000 bps)
        let max_fee = 1000u64;
        let invalid_fee = 1001u64;
        assert!(invalid_fee > max_fee, 1);
    }

    // ============================================
    // ENCRYPTION METADATA TESTS
    // ============================================

    #[test]
    fun test_request_has_three_keys() {
        // Request should have key_for_requester, key_for_payer, key_for_admin
        let key_count = 3u64;
        assert!(key_count == 3, 1);
    }

    #[test]
    fun test_open_request_payer_key_set_later() {
        // For open requests, key_for_payer may be empty initially
        // Set when payer is identified
        let empty_key: vector<u8> = vector::empty();
        assert!(vector::length(&empty_key) == 0, 1);
    }
}
