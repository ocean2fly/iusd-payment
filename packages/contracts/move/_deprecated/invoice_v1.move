/// invoice_v1 -- Pull-payment / Request / Invoice contract
///
/// State machine:
///   ACTIVE(1) --[pay_invoice]--> PAID(2)
///   ACTIVE(1) --[cancel_invoice]--> CANCELLED(3)   [merchant only]
///   ACTIVE(1) --[expire_invoice]--> EXPIRED(4)     [anyone, after due_at]
///   PAID(2)   --[refund_invoice]--> REFUNDED(5)    [merchant only, partial/full]
///
/// Key differences from pay_v2 (Push):
///   - Invoice is the on-chain entity (merchant creates first)
///   - Funds go directly to payout_address on payment (no Pool, no Claim step)
///   - Payer cannot revoke after paying
///   - Merchant can refund with configurable percentage (0-100%)
///   - First N invoices per merchant are gas-sponsored (configurable)
///   - Dual IDs: system_id (our hash) + merchant_invoice_id (merchant's own)
///   - All sensitive data encrypted: only merchant/payer/admin can decrypt
module ipay::invoice_v1 {
    use std::error;
    use std::signer;
    use std::vector;
    use initia_std::table::{Self, Table};
    use initia_std::primary_fungible_store;
    use initia_std::object::{Self, Object};
    use initia_std::fungible_asset::Metadata;
    use initia_std::event;
    use initia_std::block;
    use initia_std::hash;

    //    Status codes                                                          
    const STATUS_ACTIVE:     u8 = 1;
    const STATUS_PAID:       u8 = 2;
    const STATUS_CANCELLED:  u8 = 3;
    const STATUS_EXPIRED:    u8 = 4;
    const STATUS_REFUNDED:   u8 = 5;

    //    Fee mode                                                               
    const FEE_MODE_SENDER:    u8 = 0;  // payer pays amount + fee on top
    const FEE_MODE_RECIPIENT: u8 = 1;  // merchant absorbs fee from amount

    //    Defaults                                                               
    const DEFAULT_FEE_BPS:   u64 = 50;           // 0.5%
    const DEFAULT_FEE_CAP:   u64 = 5_000_000;    // 5 iUSD in  iUSD
    const DEFAULT_FREE_QUOTA: u64 = 50;           // first 50 invoices per merchant free

    //    Error codes                                                            
    const E_NOT_ADMIN:           u64 = 1;
    const E_NOT_MERCHANT:        u64 = 2;
    const E_INVOICE_NOT_FOUND:   u64 = 3;
    const E_INVALID_STATUS:      u64 = 4;
    const E_INVOICE_OVERDUE:     u64 = 5;
    const E_INVOICE_NOT_OVERDUE: u64 = 6;
    const E_INSUFFICIENT_FUNDS:  u64 = 7;
    const E_INVALID_REFUND_BPS:  u64 = 8;
    const E_ALREADY_INIT:        u64 = 9;

    //    Core structs                                                           

    struct Invoice has store, drop, copy {
        //    IDs                                                   
        system_id:            vector<u8>,   // 32-byte hash (contract-generated)
        merchant_invoice_id:  vector<u8>,   // merchant's own ID (e.g. "INV-2026-001")

        //    Parties                                               
        merchant:             address,      // signer who created the invoice
        payout_address:       address,      // actual destination of funds (merchant's setting)
        payer:                address,      // @0x0 until paid

        //    Amount                                                
        amount:               u64,          // total amount payer must send ( iUSD)
        fee:                  u64,          // protocol fee (locked at create time)
        net:                  u64,          // net amount merchant receives = amount - fee (if FEE_MODE_RECIPIENT)
        fee_mode:             u8,           // FEE_MODE_SENDER or FEE_MODE_RECIPIENT

        //    Time                                                  
        due_at:               u64,          // Unix timestamp (seconds); 0 = no expiry
        created_at:           u64,
        paid_at:              u64,          // 0 until paid

        //    State                                                 
        status:               u8,

        //    Refund tracking                                       
        refunded_amount:      u64,          // cumulative refunded  iUSD
        refund_bps:           u64,          // bps used in last refund

        //    Encrypted payload                                      
        // Only merchant/payer/admin can decrypt these
        encrypted_data:       vector<u8>,   // AES-GCM encrypted invoice details
        key_for_merchant:     vector<u8>,   // ECIES(randomKey, merchantViewingPubKey)
        key_for_admin:        vector<u8>,   // ECIES(randomKey, adminViewingPubKey)
        key_for_payer:        vector<u8>,   // ECIES written at pay_invoice time
    }

    struct InvoiceRegistry has key {
        invoices:         Table<vector<u8>, Invoice>,   // system_id   Invoice
        merchant_ids:     Table<address, vector<vector<u8>>>, // merchant   [system_ids]
        payer_ids:        Table<address, vector<vector<u8>>>, // payer   [system_ids] (written on pay)
        merchant_counts:  Table<address, u64>,          // merchant   invoice count
        // Config (admin-settable)
        admin:            address,
        treasury:         address,
        iusd_metadata:    Object<Metadata>,
        fee_bps:          u64,
        fee_cap:          u64,
        free_quota:       u64,                          // per-merchant free invoice count
        total_invoices:   u64,
    }

    //    Events                                                                 

    #[event]
    struct InvoiceCreatedEvent has drop, store {
        system_id:           vector<u8>,
        merchant:            address,
        payout_address:      address,
        amount:              u64,
        fee:                 u64,
        fee_mode:            u8,
        due_at:              u64,
        created_at:          u64,
    }

    #[event]
    struct InvoicePaidEvent has drop, store {
        system_id:    vector<u8>,
        payer:        address,
        amount:       u64,
        fee:          u64,
        paid_at:      u64,
    }

    #[event]
    struct InvoiceCancelledEvent has drop, store {
        system_id: vector<u8>,
        merchant:  address,
        at:        u64,
    }

    #[event]
    struct InvoiceExpiredEvent has drop, store {
        system_id: vector<u8>,
        at:        u64,
    }

    #[event]
    struct InvoiceRefundedEvent has drop, store {
        system_id:        vector<u8>,
        merchant:         address,
        payer:            address,
        refund_amount:    u64,
        refund_bps:       u64,
        at:               u64,
    }

    //    Init                                                                   

    public entry fun initialize(
        admin:         &signer,
        iusd_metadata: Object<Metadata>,
        treasury:      address,
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(!exists<InvoiceRegistry>(admin_addr), error::already_exists(E_ALREADY_INIT));

        move_to(admin, InvoiceRegistry {
            invoices:        table::new(),
            merchant_ids:    table::new(),
            payer_ids:       table::new(),
            merchant_counts: table::new(),
            admin:           admin_addr,
            treasury,
            iusd_metadata,
            fee_bps:         DEFAULT_FEE_BPS,
            fee_cap:         DEFAULT_FEE_CAP,
            free_quota:      DEFAULT_FREE_QUOTA,
            total_invoices:  0,
        });
    }

    //    Admin config                                                           

    public entry fun set_free_quota(admin: &signer, quota: u64) acquires InvoiceRegistry {
        let admin_addr = signer::address_of(admin);
        let reg = borrow_global_mut<InvoiceRegistry>(admin_addr);
        reg.free_quota = quota;
    }

    public entry fun set_fee_params(
        admin: &signer,
        fee_bps: u64,
        fee_cap: u64,
    ) acquires InvoiceRegistry {
        let admin_addr = signer::address_of(admin);
        let reg = borrow_global_mut<InvoiceRegistry>(admin_addr);
        reg.fee_bps = fee_bps;
        reg.fee_cap = fee_cap;
    }

    public entry fun set_treasury(admin: &signer, treasury: address) acquires InvoiceRegistry {
        let admin_addr = signer::address_of(admin);
        let reg = borrow_global_mut<InvoiceRegistry>(admin_addr);
        reg.treasury = treasury;
    }

    //    Internal helpers                                                       

    fun calc_fee(amount: u64, fee_bps: u64, fee_cap: u64): u64 {
        let fee = amount * fee_bps / 10000;
        if (fee > fee_cap) fee_cap else fee
    }

    fun now_seconds(): u64 {
        // block::get_current_block_timestamp() returns microseconds on Initia
        block::get_current_block_timestamp() / 1_000_000
    }

    /// Generate system_id by hashing (merchant_addr_bytes ++ timestamp ++ counter)
    fun gen_system_id(merchant: address, created_at: u64, counter: u64): vector<u8> {
        let seed = vector::empty<u8>();
        // merchant address as bytes
        let addr_bytes = std::bcs::to_bytes(&merchant);
        vector::append(&mut seed, addr_bytes);
        let ts_bytes = std::bcs::to_bytes(&created_at);
        vector::append(&mut seed, ts_bytes);
        let cnt_bytes = std::bcs::to_bytes(&counter);
        vector::append(&mut seed, cnt_bytes);
        hash::sha3_256(seed)
    }

    //    1. create_invoice                                                      

    public entry fun create_invoice(
        merchant:            &signer,
        merchant_invoice_id: vector<u8>,
        payout_address:      address,
        amount:              u64,          // total payer pays (depends on fee_mode)
        fee_mode:            u8,
        due_at:              u64,          // Unix timestamp; 0 = no expiry
        encrypted_data:      vector<u8>,
        key_for_merchant:    vector<u8>,
        key_for_admin:       vector<u8>,
    ) acquires InvoiceRegistry {
        // Registry lives at admin address (the deployer/@ipay)
        // We use a hard-coded module address reference
        let reg_addr = @ipay;
        let reg = borrow_global_mut<InvoiceRegistry>(reg_addr);

        let merchant_addr = signer::address_of(merchant);
        let created_at = now_seconds();

        // Bump counter
        let count = if (table::contains(&reg.merchant_counts, merchant_addr)) {
            *table::borrow(&reg.merchant_counts, merchant_addr)
        } else { 0 };

        // Compute fee
        let fee = calc_fee(amount, reg.fee_bps, reg.fee_cap);
        let (net, payer_pays) = if (fee_mode == FEE_MODE_RECIPIENT) {
            // merchant absorbs fee: payer pays `amount`, merchant gets amount-fee
            (amount - fee, amount)
        } else {
            // sender pays fee on top: payer pays amount+fee, merchant gets amount
            (amount, amount + fee)
        };
        let _ = payer_pays; // stored in invoice.amount for reference by payer

        // Generate system_id
        let system_id = gen_system_id(merchant_addr, created_at, reg.total_invoices);

        // Build invoice
        let invoice = Invoice {
            system_id:           copy system_id,
            merchant_invoice_id,
            merchant:            merchant_addr,
            payout_address,
            payer:               @0x0,
            amount,
            fee,
            net,
            fee_mode,
            due_at,
            created_at,
            paid_at:             0,
            status:              STATUS_ACTIVE,
            refunded_amount:     0,
            refund_bps:          0,
            encrypted_data,
            key_for_merchant,
            key_for_admin,
            key_for_payer:       vector::empty(),
        };

        table::add(&mut reg.invoices, copy system_id, invoice);

        // Track by merchant
        if (!table::contains(&reg.merchant_ids, merchant_addr)) {
            table::add(&mut reg.merchant_ids, merchant_addr, vector::empty());
        };
        vector::push_back(table::borrow_mut(&mut reg.merchant_ids, merchant_addr), copy system_id);

        // Update count
        if (table::contains(&reg.merchant_counts, merchant_addr)) {
            *table::borrow_mut(&mut reg.merchant_counts, merchant_addr) = count + 1;
        } else {
            table::add(&mut reg.merchant_counts, merchant_addr, 1);
        };
        reg.total_invoices = reg.total_invoices + 1;

        event::emit(InvoiceCreatedEvent {
            system_id,
            merchant: merchant_addr,
            payout_address,
            amount,
            fee,
            fee_mode,
            due_at,
            created_at,
        });
    }

    //    2. pay_invoice                                                         

    public entry fun pay_invoice(
        payer:         &signer,
        system_id:     vector<u8>,
        key_for_payer: vector<u8>,   // ECIES encrypted receipt key for payer
    ) acquires InvoiceRegistry {
        let reg_addr = @ipay;
        let reg = borrow_global_mut<InvoiceRegistry>(reg_addr);
        let payer_addr = signer::address_of(payer);

        assert!(table::contains(&reg.invoices, system_id), error::not_found(E_INVOICE_NOT_FOUND));
        let invoice = table::borrow_mut(&mut reg.invoices, system_id);

        assert!(invoice.status == STATUS_ACTIVE, error::invalid_state(E_INVALID_STATUS));

        // Check not overdue
        if (invoice.due_at > 0) {
            assert!(now_seconds() <= invoice.due_at, error::invalid_state(E_INVOICE_OVERDUE));
        };

        // Compute payer's actual payment amount
        let payer_pays = if (invoice.fee_mode == FEE_MODE_SENDER) {
            invoice.amount + invoice.fee
        } else {
            invoice.amount  // fee absorbed by merchant (deducted from net)
        };

        // Transfer: fee   treasury
        primary_fungible_store::transfer(payer, reg.iusd_metadata, reg.treasury, invoice.fee);

        // Transfer: net   payout_address
        primary_fungible_store::transfer(payer, reg.iusd_metadata, invoice.payout_address, invoice.net);

        let _ = payer_pays; // payer_pays = fee + net (already validated above)

        let paid_at = now_seconds();
        invoice.status    = STATUS_PAID;
        invoice.payer     = payer_addr;
        invoice.paid_at   = paid_at;
        invoice.key_for_payer = key_for_payer;

        // Track by payer
        if (!table::contains(&reg.payer_ids, payer_addr)) {
            table::add(&mut reg.payer_ids, payer_addr, vector::empty());
        };
        vector::push_back(table::borrow_mut(&mut reg.payer_ids, payer_addr), copy system_id);

        let ev_system_id = *&invoice.system_id;
        let ev_amount    = invoice.amount;
        let ev_fee       = invoice.fee;
        event::emit(InvoicePaidEvent {
            system_id: ev_system_id,
            payer: payer_addr,
            amount: ev_amount,
            fee: ev_fee,
            paid_at,
        });
    }

    //    3. cancel_invoice                                                      

    public entry fun cancel_invoice(
        merchant:  &signer,
        system_id: vector<u8>,
    ) acquires InvoiceRegistry {
        let reg_addr = @ipay;
        let reg = borrow_global_mut<InvoiceRegistry>(reg_addr);
        let merchant_addr = signer::address_of(merchant);

        assert!(table::contains(&reg.invoices, system_id), error::not_found(E_INVOICE_NOT_FOUND));
        let invoice = table::borrow_mut(&mut reg.invoices, system_id);

        assert!(invoice.merchant == merchant_addr, error::permission_denied(E_NOT_MERCHANT));
        assert!(invoice.status == STATUS_ACTIVE, error::invalid_state(E_INVALID_STATUS));

        invoice.status = STATUS_CANCELLED;

        let ev_sid = *&invoice.system_id;
        event::emit(InvoiceCancelledEvent {
            system_id: ev_sid,
            merchant: merchant_addr,
            at: now_seconds(),
        });
    }

    //    4. expire_invoice                                                      

    public entry fun expire_invoice(
        system_id: vector<u8>,
    ) acquires InvoiceRegistry {
        let reg_addr = @ipay;
        let reg = borrow_global_mut<InvoiceRegistry>(reg_addr);

        assert!(table::contains(&reg.invoices, system_id), error::not_found(E_INVOICE_NOT_FOUND));
        let invoice = table::borrow_mut(&mut reg.invoices, system_id);

        assert!(invoice.status == STATUS_ACTIVE, error::invalid_state(E_INVALID_STATUS));
        assert!(invoice.due_at > 0 && now_seconds() > invoice.due_at,
                error::invalid_state(E_INVOICE_NOT_OVERDUE));

        invoice.status = STATUS_EXPIRED;

        let ev_sid2 = *&invoice.system_id;
        event::emit(InvoiceExpiredEvent {
            system_id: ev_sid2,
            at: now_seconds(),
        });
    }

    //    5. refund_invoice                                                      

    public entry fun refund_invoice(
        merchant:    &signer,
        system_id:   vector<u8>,
        refund_bps:  u64,    // 0~10000; e.g. 10000=full, 5000=50%
    ) acquires InvoiceRegistry {
        let reg_addr = @ipay;
        let reg = borrow_global_mut<InvoiceRegistry>(reg_addr);
        let merchant_addr = signer::address_of(merchant);

        assert!(table::contains(&reg.invoices, system_id), error::not_found(E_INVOICE_NOT_FOUND));
        let invoice = table::borrow_mut(&mut reg.invoices, system_id);

        assert!(invoice.merchant == merchant_addr, error::permission_denied(E_NOT_MERCHANT));
        assert!(invoice.status == STATUS_PAID, error::invalid_state(E_INVALID_STATUS));
        assert!(refund_bps <= 10000, error::invalid_argument(E_INVALID_REFUND_BPS));

        // Refund = net_received_by_merchant * refund_bps / 10000
        // Protocol fee is non-refundable (protocol revenue)
        let refund_amount = invoice.net * refund_bps / 10000;

        // Merchant transfers from their own balance to payer
        primary_fungible_store::transfer(merchant, reg.iusd_metadata, invoice.payer, refund_amount);

        invoice.status          = STATUS_REFUNDED;
        invoice.refunded_amount = refund_amount;
        invoice.refund_bps      = refund_bps;

        let ev_sid3   = *&invoice.system_id;
        let ev_payer  = invoice.payer;
        event::emit(InvoiceRefundedEvent {
            system_id:    ev_sid3,
            merchant:     merchant_addr,
            payer:        ev_payer,
            refund_amount,
            refund_bps,
            at:           now_seconds(),
        });
    }

    //    View functions                                                         

    #[view]
    public fun get_invoice(system_id: vector<u8>): (
        vector<u8>, // merchant_invoice_id
        address,    // merchant
        address,    // payout_address
        address,    // payer
        u64,        // amount
        u64,        // fee
        u64,        // net
        u8,         // fee_mode
        u8,         // status
        u64,        // due_at
        u64,        // created_at
        u64,        // paid_at
        u64,        // refunded_amount
        vector<u8>, // encrypted_data
        vector<u8>, // key_for_merchant
        vector<u8>, // key_for_admin
        vector<u8>, // key_for_payer
    ) acquires InvoiceRegistry {
        let reg = borrow_global<InvoiceRegistry>(@ipay);
        assert!(table::contains(&reg.invoices, system_id), error::not_found(E_INVOICE_NOT_FOUND));
        let inv = table::borrow(&reg.invoices, system_id);
        (
            inv.merchant_invoice_id,
            inv.merchant,
            inv.payout_address,
            inv.payer,
            inv.amount,
            inv.fee,
            inv.net,
            inv.fee_mode,
            inv.status,
            inv.due_at,
            inv.created_at,
            inv.paid_at,
            inv.refunded_amount,
            inv.encrypted_data,
            inv.key_for_merchant,
            inv.key_for_admin,
            inv.key_for_payer,
        )
    }

    #[view]
    public fun get_invoice_status(system_id: vector<u8>): u8 acquires InvoiceRegistry {
        let reg = borrow_global<InvoiceRegistry>(@ipay);
        assert!(table::contains(&reg.invoices, system_id), error::not_found(E_INVOICE_NOT_FOUND));
        table::borrow(&reg.invoices, system_id).status
    }

    #[view]
    public fun get_merchant_invoice_ids(merchant: address): vector<vector<u8>> acquires InvoiceRegistry {
        let reg = borrow_global<InvoiceRegistry>(@ipay);
        if (!table::contains(&reg.merchant_ids, merchant)) return vector::empty();
        *table::borrow(&reg.merchant_ids, merchant)
    }

    #[view]
    public fun get_payer_invoice_ids(payer: address): vector<vector<u8>> acquires InvoiceRegistry {
        let reg = borrow_global<InvoiceRegistry>(@ipay);
        if (!table::contains(&reg.payer_ids, payer)) return vector::empty();
        *table::borrow(&reg.payer_ids, payer)
    }

    #[view]
    public fun get_merchant_invoice_count(merchant: address): u64 acquires InvoiceRegistry {
        let reg = borrow_global<InvoiceRegistry>(@ipay);
        if (!table::contains(&reg.merchant_counts, merchant)) return 0;
        *table::borrow(&reg.merchant_counts, merchant)
    }

    #[view]
    public fun is_free_quota_available(merchant: address): bool acquires InvoiceRegistry {
        let reg = borrow_global<InvoiceRegistry>(@ipay);
        let count = if (table::contains(&reg.merchant_counts, merchant)) {
            *table::borrow(&reg.merchant_counts, merchant)
        } else { 0 };
        count < reg.free_quota
    }

    #[view]
    public fun get_config(): (u64, u64, u64, address) acquires InvoiceRegistry {
        let reg = borrow_global<InvoiceRegistry>(@ipay);
        (reg.fee_bps, reg.fee_cap, reg.free_quota, reg.treasury)
    }
}
