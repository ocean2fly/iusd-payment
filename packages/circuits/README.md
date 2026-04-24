# @ipay/circuits

ZK circuits for iPay v2 — a ZK-private iUSD payment protocol on Initia blockchain.

## Circuits

| Circuit | Purpose | Constraints |
|---------|---------|-------------|
| `commitment` | `Poseidon(instrument, version, amount, target, nonce, params_hash)` with range checks | 422 |
| `nullifier` | `Poseidon(nonce, spending_key)` | 243 |
| `merkle_proof` | Depth-20 Poseidon Merkle inclusion proof | 4,920 |
| `payment` | Full payment proof (commitment + nullifier + Merkle) | 5,585 |
| `subscription` | Subscription with period bounds checking | 5,651 |
| `check_named` | Named check — proves recipient stealth address ownership | 5,585 |
| `check_bearer` | Bearer check — proves knowledge of claim code preimage | 5,801 |

## Setup

```bash
npm install
bash scripts/setup.sh   # compile circuits + download ptau + generate keys
```

## Test

```bash
npm test
```

## Architecture

- **Curve:** BN254
- **Hash:** Poseidon (circomlib)
- **Proof system:** Groth16
- **Merkle tree depth:** 20 (1M+ leaves)
- **Amount range:** 0 < amount < 2^64

## Test Coverage

24 tests covering all TEST_SPEC vectors (TC-C1 through TC-CB2), including positive proofs and negative constraint violation checks.
