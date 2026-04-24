/// iPay Config Oracle
/// Stores contract addresses for frontend/backend discovery
/// Deploy once, update when contracts upgrade
module ipay::config {
    use std::error;
    use std::signer;

    // Error codes
    const E_NOT_ADMIN: u64 = 1;
    const E_NOT_INITIALIZED: u64 = 2;
    const E_ALREADY_INITIALIZED: u64 = 3;

    /// Global config stored at deployer address
    struct Config has key {
        admin: address,
        send_contract: address,
        version: u64,
    }

    /// Initialize config (call once after deploy)
    public entry fun initialize(
        deployer: &signer,
        send_contract: address,
        version: u64,
    ) {
        let deployer_addr = signer::address_of(deployer);
        assert!(!exists<Config>(deployer_addr), error::already_exists(E_ALREADY_INITIALIZED));
        
        move_to(deployer, Config {
            admin: deployer_addr,
            send_contract,
            version,
        });
    }

    /// Update send contract address (admin only)
    public entry fun set_send_contract(
        admin: &signer,
        new_contract: address,
    ) acquires Config {
        let admin_addr = signer::address_of(admin);
        let config = borrow_global_mut<Config>(admin_addr);
        assert!(config.admin == admin_addr, error::permission_denied(E_NOT_ADMIN));
        config.send_contract = new_contract;
    }

    /// Update version (admin only)
    public entry fun set_version(
        admin: &signer,
        new_version: u64,
    ) acquires Config {
        let admin_addr = signer::address_of(admin);
        let config = borrow_global_mut<Config>(admin_addr);
        assert!(config.admin == admin_addr, error::permission_denied(E_NOT_ADMIN));
        config.version = new_version;
    }

    /// Transfer admin (admin only)
    public entry fun transfer_admin(
        admin: &signer,
        new_admin: address,
    ) acquires Config {
        let admin_addr = signer::address_of(admin);
        let config = borrow_global_mut<Config>(admin_addr);
        assert!(config.admin == admin_addr, error::permission_denied(E_NOT_ADMIN));
        config.admin = new_admin;
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /// Get current config (send_contract, version)
    #[view]
    public fun get_config(oracle_addr: address): (address, u64) acquires Config {
        let config = borrow_global<Config>(oracle_addr);
        (config.send_contract, config.version)
    }

    /// Get send contract address only
    #[view]
    public fun get_send_contract(oracle_addr: address): address acquires Config {
        borrow_global<Config>(oracle_addr).send_contract
    }

    /// Get version only
    #[view]
    public fun get_version(oracle_addr: address): u64 acquires Config {
        borrow_global<Config>(oracle_addr).version
    }
}
