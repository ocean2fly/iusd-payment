pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// nullifier = Poseidon(nonce, spending_key)
template Nullifier() {
    signal input nonce;
    signal input spending_key;
    signal output nullifier;

    component poseidon = Poseidon(2);
    poseidon.inputs[0] <== nonce;
    poseidon.inputs[1] <== spending_key;

    nullifier <== poseidon.out;
}

component main = Nullifier();
