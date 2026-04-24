# Contract Changes for PENDING_REGISTER State

## 1. New Status Code

```move
const STATUS_PENDING_REGISTER: u8 = 8;
```

## 2. Modify `spend()` Function

在 spend() 中，检查收款方是否有 viewing_pubkey：

```move
public entry fun spend(
    relayer: &signer,
    pool_addr: address,
    order_id: vector<u8>,
    nullifier: vector<u8>,
    merkle_root: vector<u8>,
) acquires SendPool, UserSettings {
    // ... existing validations ...
    
    // Get recipient address from recipient_cooked (need to store raw recipient in order)
    // Or: pass recipient_address as parameter
    
    // Check if recipient has viewing pubkey
    let recipient_has_pubkey = false;
    if (exists<UserSettings>(recipient_addr)) {
        let settings = borrow_global<UserSettings>(recipient_addr);
        recipient_has_pubkey = vector::length(&settings.viewing_pubkey) > 0;
    };
    
    if (recipient_has_pubkey) {
        order.status = STATUS_PENDING_CLAIM;
    } else {
        order.status = STATUS_PENDING_REGISTER;
    };
    
    // ... rest of function ...
}
```

**问题：** 当前 order 只存储 `recipient_cooked` (hash)，不存储原始 recipient 地址。
需要修改 SendOrder 结构体来存储 recipient 地址。

## 3. New `activate_order()` Function

```move
/// A7: Activate - Relayer activates pending_register order after recipient registers pubkey
/// S8 pending_register -> S2 pending_claim
public entry fun activate_order(
    relayer: &signer,
    pool_addr: address,
    order_id: vector<u8>,
    new_key_for_user: vector<u8>,  // Re-encrypted with recipient's new pubkey
) acquires SendPool {
    let pool = borrow_global_mut<SendPool>(pool_addr);
    let relayer_addr = signer::address_of(relayer);
    
    // Verify relayer is authorized
    assert!(
        relayer_addr == pool.owner || table::contains(&pool.relayers, relayer_addr),
        error::permission_denied(E_NOT_RELAYER)
    );
    
    // Get and validate order
    assert!(table::contains(&pool.orders, order_id), error::not_found(E_ORDER_NOT_FOUND));
    let order = table::borrow_mut(&mut pool.orders, order_id);
    
    // Must be in PENDING_REGISTER state
    assert!(order.status == STATUS_PENDING_REGISTER, error::invalid_state(E_INVALID_TRANSITION));
    
    // Check not expired
    order_common::check_not_expired(order.expires_at);
    
    // Update key_for_user with new encrypted version
    order.key_for_user = new_key_for_user;
    
    // Transition to pending_claim
    order.status = STATUS_PENDING_CLAIM;
    
    // Emit event (optional)
    // event::emit(OrderActivated { order_id, ... });
}
```

## 4. Modify `revoke()` Function

确保 PENDING_REGISTER 状态下也可以 revoke：

```move
// In revoke() function, add STATUS_PENDING_REGISTER to valid states
assert!(
    order.status == STATUS_CREATED || 
    order.status == STATUS_PENDING_CLAIM ||
    order.status == STATUS_PENDING_REGISTER,  // 新增
    error::invalid_state(E_INVALID_TRANSITION)
);
```

## 5. Modify SendOrder Struct (Optional but Recommended)

为了让 relayer 知道收款方地址，需要存储：

```move
struct SendOrder has store {
    // ... existing fields ...
    recipient: address,  // 新增：存储收款方地址
}
```

或者在 deposit() 调用时传入 recipient 地址作为参数。

## 6. View Function Update

```move
public fun get_order_status_name(status: u8): String {
    if (status == STATUS_PENDING_REGISTER) {
        string::utf8(b"Pending Register")
    } else if (...) {
        // existing code
    }
}
```

---

## Relayer 端修改

1. **监听 set_viewing_pubkey 事件**
   - 收款方注册公钥后，检查是否有 PENDING_REGISTER 订单

2. **重新加密逻辑**
   ```typescript
   // 1. 获取 PENDING_REGISTER 状态的订单
   // 2. 用 admin 私钥解密 key_for_admin
   // 3. 用收款方新公钥重新加密
   // 4. 调用 activate_order(order_id, new_key_for_user)
   ```

---

## 前端修改

1. **History/Claims 页面**
   - 显示 PENDING_REGISTER 状态的订单
   - 对于收款方：显示 "等待注册公钥" 提示
   - 点击后引导注册

2. **状态显示**
   ```typescript
   case 'pending_register':
     return { label: 'Pending Register', variant: 'warning' }
   ```
