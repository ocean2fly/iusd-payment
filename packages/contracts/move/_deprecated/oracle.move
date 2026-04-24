/// Oracle Module - Single Source of Truth for Contract Addresses
/// 
/// Stores the current Pay contract address and allows admin to update it.
/// All clients should query this oracle to get the latest contract address.
module ipay::oracle {
    use std::error;
    use std::signer;
    use initia_std::event;

    /// Error codes
    const E_NOT_ADMIN: u64 = 1;
    const E_NOT_INITIALIZED: u64 = 2;
    const E_ALREADY_INITIALIZED: u64 = 3;

    /// Oracle configuration stored at module address
    struct OracleConfig has key {
        /// Admin who can update the oracle
        admin: address,
        /// Current Pay contract address
        pay_contract: address,
        /// Contract version (e.g., 700 for v7.0.0)
        version: u64,
    }

    /// Event emitted when contract address is updated
    #[event]
    struct ContractUpdated has drop, store {
        old_contract: address,
        new_contract: address,
        new_version: u64,
        updated_by: address,
    }

    /// Initialize the oracle (called once by admin)
    public entry fun initialize(
        admin: &signer,
        pay_contract: address,
        version: u64,
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(!exists<OracleConfig>(admin_addr), error::already_exists(E_ALREADY_INITIALIZED));
        
        move_to(admin, OracleConfig {
            admin: admin_addr,
            pay_contract,
            version,
        });
    }

    /// Update the Pay contract address (admin only)
    public entry fun update_contract(
        admin: &signer,
        oracle_addr: address,
        new_contract: address,
        new_version: u64,
    ) acquires OracleConfig {
        let admin_addr = signer::address_of(admin);
        assert!(exists<OracleConfig>(oracle_addr), error::not_found(E_NOT_INITIALIZED));
        
        let config = borrow_global_mut<OracleConfig>(oracle_addr);
        assert!(config.admin == admin_addr, error::permission_denied(E_NOT_ADMIN));
        
        let old_contract = config.pay_contract;
        config.pay_contract = new_contract;
        config.version = new_version;

        event::emit(ContractUpdated {
            old_contract,
            new_contract,
            new_version,
            updated_by: admin_addr,
        });
    }

    /// Transfer admin rights to a new address
    public entry fun transfer_admin(
        admin: &signer,
        oracle_addr: address,
        new_admin: address,
    ) acquires OracleConfig {
        let admin_addr = signer::address_of(admin);
        assert!(exists<OracleConfig>(oracle_addr), error::not_found(E_NOT_INITIALIZED));
        
        let config = borrow_global_mut<OracleConfig>(oracle_addr);
        assert!(config.admin == admin_addr, error::permission_denied(E_NOT_ADMIN));
        
        config.admin = new_admin;
    }

    // =========================================================================
    // View Functions (address parameter required for compatibility)
    // =========================================================================

    #[view]
    /// Get the current Pay contract address
    public fun get_pay_contract(oracle_addr: address): address acquires OracleConfig {
        assert!(exists<OracleConfig>(oracle_addr), error::not_found(E_NOT_INITIALIZED));
        borrow_global<OracleConfig>(oracle_addr).pay_contract
    }

    #[view]
    /// Get the current version
    public fun get_version(oracle_addr: address): u64 acquires OracleConfig {
        assert!(exists<OracleConfig>(oracle_addr), error::not_found(E_NOT_INITIALIZED));
        borrow_global<OracleConfig>(oracle_addr).version
    }

    #[view]
    /// Get full config (admin, pay_contract, version)
    public fun get_config(oracle_addr: address): (address, address, u64) acquires OracleConfig {
        assert!(exists<OracleConfig>(oracle_addr), error::not_found(E_NOT_INITIALIZED));
        let config = borrow_global<OracleConfig>(oracle_addr);
        (config.admin, config.pay_contract, config.version)
    }

    #[view]
    /// Check if oracle is initialized at address
    public fun is_initialized(oracle_addr: address): bool {
        exists<OracleConfig>(oracle_addr)
    }
}
