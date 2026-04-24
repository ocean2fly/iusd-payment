pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// commitment = Poseidon(instrument, version, amount, target, nonce, params_hash)
// Constraints: 0 < amount < 2^64
template Commitment() {
    signal input instrument;
    signal input version;
    signal input amount;
    signal input target;
    signal input nonce;
    signal input params_hash;
    signal output commitment;

    // Range check: amount fits in 64 bits (amount < 2^64)
    component n2b = Num2Bits(64);
    n2b.in <== amount;

    // amount > 0
    component isz = IsZero();
    isz.in <== amount;
    isz.out === 0;

    // Compute commitment
    component poseidon = Poseidon(6);
    poseidon.inputs[0] <== instrument;
    poseidon.inputs[1] <== version;
    poseidon.inputs[2] <== amount;
    poseidon.inputs[3] <== target;
    poseidon.inputs[4] <== nonce;
    poseidon.inputs[5] <== params_hash;

    commitment <== poseidon.out;
}

component main = Commitment();
