/// iPay v2 Factory - Create new PayPoolV2 instances
module ipay::pay_v2_factory {
    use std::signer;
    use initia_std::event;
    use initia_std::object::{Self, Object};
    use initia_std::fungible_asset::Metadata;
    
    use ipay::pay_v2::{Self, PayPoolV2};
    use ipay::oracle;

    // ============================================
    // EVENTS
    // ============================================

    #[event]
    struct PoolV2CreatedEvent has drop, store {
        pool_address: address,
        owner: address,
        version: u64,
    }

    // ============================================
    // FUNCTIONS
    // ============================================

    /// Create a new v2 pool and register it with the Oracle
    public entry fun create_pool(
        owner: &signer,
        oracle_addr: address,
        iusd_fa: Object<Metadata>,
        fee_bps: u64,
        fee_cap: u64,
        version: u64,
    ) {
        let owner_addr = signer::address_of(owner);
        
        // Create the pool
        let pool = pay_v2::create_pool(owner, iusd_fa, fee_bps, fee_cap);
        let pool_addr = object::object_address(&pool);
        
        // Update Oracle with new pool address
        oracle::update_contract(owner, oracle_addr, pool_addr, version);
        
        // Emit event
        event::emit(PoolV2CreatedEvent {
            pool_address: pool_addr,
            owner: owner_addr,
            version,
        });
    }

    /// Create pool without Oracle update (for testing)
    public entry fun create_pool_no_oracle(
        owner: &signer,
        iusd_fa: Object<Metadata>,
        fee_bps: u64,
        fee_cap: u64,
    ) {
        let owner_addr = signer::address_of(owner);
        let pool = pay_v2::create_pool(owner, iusd_fa, fee_bps, fee_cap);
        let pool_addr = object::object_address(&pool);
        
        event::emit(PoolV2CreatedEvent {
            pool_address: pool_addr,
            owner: owner_addr,
            version: 0,
        });
    }
}
