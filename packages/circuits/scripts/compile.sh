#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"

mkdir -p "$BUILD_DIR"

CIRCUITS=(commitment nullifier merkle_proof payment subscription check_named check_bearer)

for circuit in "${CIRCUITS[@]}"; do
    echo "Compiling $circuit..."
    circom "$ROOT_DIR/circuits/$circuit.circom" \
        --r1cs --wasm --sym \
        -o "$BUILD_DIR" \
        -l "$ROOT_DIR/node_modules"
    echo "  ✓ $circuit compiled"
done

echo ""
echo "All circuits compiled successfully."
