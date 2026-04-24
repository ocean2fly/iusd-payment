#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
KEYS_DIR="$ROOT_DIR/keys"
PTAU_FILE="$KEYS_DIR/powersOfTau28_hez_final_15.ptau"

mkdir -p "$BUILD_DIR" "$KEYS_DIR"

# Step 1: Download Powers of Tau if not present
if [ ! -f "$PTAU_FILE" ]; then
    echo "Downloading Powers of Tau (ptau_15)..."
    curl -L -o "$PTAU_FILE" \
        "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau"
    echo "  ✓ ptau downloaded"
else
    echo "  ✓ ptau already present"
fi

# Step 2: Compile all circuits
echo ""
echo "=== Compiling circuits ==="
bash "$SCRIPT_DIR/compile.sh"

# Step 3: Generate proving/verification keys for each circuit
echo ""
echo "=== Generating keys ==="
CIRCUITS=(commitment nullifier merkle_proof payment subscription check_named check_bearer)

for circuit in "${CIRCUITS[@]}"; do
    echo "Generating keys for $circuit..."

    # Generate zkey (Groth16)
    npx snarkjs groth16 setup \
        "$BUILD_DIR/$circuit.r1cs" \
        "$PTAU_FILE" \
        "$KEYS_DIR/${circuit}_0000.zkey"

    # Contribute to phase 2 ceremony (deterministic for dev)
    npx snarkjs zkey contribute \
        "$KEYS_DIR/${circuit}_0000.zkey" \
        "$KEYS_DIR/${circuit}_final.zkey" \
        --name="iPay dev contribution" \
        -e="ipay-dev-entropy-$(date +%s)"

    # Export verification key
    npx snarkjs zkey export verificationkey \
        "$KEYS_DIR/${circuit}_final.zkey" \
        "$KEYS_DIR/${circuit}_vkey.json"

    # Clean up intermediate zkey
    rm -f "$KEYS_DIR/${circuit}_0000.zkey"

    echo "  ✓ $circuit keys generated"
done

echo ""
echo "=== Setup complete ==="
echo "Build artifacts: $BUILD_DIR"
echo "Keys: $KEYS_DIR"
