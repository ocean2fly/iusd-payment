/// iPay Pool Factory
/// 
/// Creates new PayPool instances as Objects with unique addresses.
/// Same deployer can create multiple pools (new deployments).
/// 
/// Flow:
///   1. Factory deployed once (upgrade-compatible)
///   2. create_pool() -> new Object<PayPool> with unique address
///   3. Oracle stores current active pool address
///   4. Services query Oracle -> get pool address -> call pool functions
module ipay::pay_factory {
    use std::signer;
    use initia_std::object::{Self, Object};
    use initia_std::fungible_asset::Metadata;
    use initia_std::event;
    
    use ipay::pay::{Self, PayPool};

    /// Event emitted when a new pool is created
    #[event]
    struct PoolCreated has drop, store {
        pool_address: address,
        owner: address,
        treasury: address,
        fee_bps: u64,
        version: u64,
    }

    /// Factory state (minimal, just tracks created pools)
    struct FactoryState has key {
        pools_created: u64,
    }

    /// Initialize factory (called once on deploy)
    public entry fun initialize(deployer: &signer) {
        let deployer_addr = signer::address_of(deployer);
        assert!(!exists<FactoryState>(deployer_addr), 1); // E_ALREADY_INITIALIZED
        
        move_to(deployer, FactoryState {
            pools_created: 0,
        });
    }

    /// Create a new PayPool instance
    /// Returns the Object address of the new pool
    public entry fun create_pool(
        owner: &signer,
        iusd_fa: Object<Metadata>,
        treasury: address,
        fee_bps: u64,
        fee_cap: u64,
        admin_pubkey: vector<u8>,
        version: u64,
    ) acquires FactoryState {
        let owner_addr = signer::address_of(owner);
        
        // Create pool using pay module
        let pool_obj = pay::create_pool_object(
            owner,
            iusd_fa,
            treasury,
            fee_bps,
            fee_cap,
            admin_pubkey,
        );
        
        let pool_address = object::object_address(&pool_obj);
        
        // Update factory state
        if (exists<FactoryState>(@ipay)) {
            let state = borrow_global_mut<FactoryState>(@ipay);
            state.pools_created = state.pools_created + 1;
        };

        // Emit event
        event::emit(PoolCreated {
            pool_address,
            owner: owner_addr,
            treasury,
            fee_bps,
            version,
        });
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    #[view]
    public fun get_pools_created(): u64 acquires FactoryState {
        if (exists<FactoryState>(@ipay)) {
            borrow_global<FactoryState>(@ipay).pools_created
        } else {
            0
        }
    }
}
