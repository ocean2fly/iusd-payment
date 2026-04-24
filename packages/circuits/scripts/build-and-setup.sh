#!/bin/bash
# Full ZK circuit build: compile + trusted setup + export
# Run from: packages/circuits/
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
KEYS_DIR="$ROOT_DIR/keys"
PTAU="$KEYS_DIR/powersOfTau28_hez_final_15.ptau"
OUTPUT_DIR="$ROOT_DIR/../../app/public/zk"

mkdir -p "$BUILD_DIR" "$OUTPUT_DIR"

CIRCUITS=(payment subscription check_named check_bearer nullifier commitment merkle_proof)

echo "=== Step 1: Compile circuits ==="
for circuit in "${CIRCUITS[@]}"; do
  CIRCOM_FILE="$ROOT_DIR/circuits/$circuit.circom"
  if [ ! -f "$CIRCOM_FILE" ]; then
    echo "  ⚠ $circuit.circom not found, skipping"
    continue
  fi
  echo "  Compiling $circuit..."
  circom "$CIRCOM_FILE" \
    --r1cs --wasm --sym \
    -o "$BUILD_DIR" \
    -l "$ROOT_DIR/node_modules"
  echo "  ✓ $circuit compiled"
done

echo ""
echo "=== Step 2: Groth16 trusted setup ==="
for circuit in "${CIRCUITS[@]}"; do
  echo "  Setting up $circuit..."
  
  # Phase 2 setup
  node --max-old-space-size=4096 \
    $(which snarkjs) groth16 setup \
    "$BUILD_DIR/$circuit.r1cs" \
    "$PTAU" \
    "$BUILD_DIR/${circuit}_0.zkey"

  # Add contribution (deterministic beacon for testnet)
  echo "iPay testnet beacon 2026" | node $(which snarkjs) zkey beacon \
    "$BUILD_DIR/${circuit}_0.zkey" \
    "$BUILD_DIR/${circuit}_final.zkey" \
    0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f \
    10 -n "iPay Testnet Beacon"

  # Export verification key
  node $(which snarkjs) zkey export verificationkey \
    "$BUILD_DIR/${circuit}_final.zkey" \
    "$KEYS_DIR/${circuit}_vkey.json"

  echo "  ✓ $circuit setup complete"
done

echo ""
echo "=== Step 3: Copy to app/public/zk/ ==="
for circuit in "${CIRCUITS[@]}"; do
  # Copy wasm
  mkdir -p "$OUTPUT_DIR/${circuit}_js"
  cp "$BUILD_DIR/${circuit}_js/${circuit}.wasm" "$OUTPUT_DIR/${circuit}_js/"
  cp "$BUILD_DIR/${circuit}_js/witness_calculator.js" "$OUTPUT_DIR/${circuit}_js/"
  
  # Copy zkey
  cp "$BUILD_DIR/${circuit}_final.zkey" "$OUTPUT_DIR/"
  
  # Copy vkey
  cp "$KEYS_DIR/${circuit}_vkey.json" "$OUTPUT_DIR/"
  
  echo "  ✓ $circuit files deployed to app/public/zk/"
done

echo ""
echo "=== Done! ZK files deployed ==="
ls -lh "$OUTPUT_DIR"
