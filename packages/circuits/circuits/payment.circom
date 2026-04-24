pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Commitment sub-circuit (no main component)
template CommitmentHasher() {
    signal input instrument;
    signal input version;
    signal input amount;
    signal input target;
    signal input nonce;
    signal input params_hash;
    signal output commitment;

    component n2b = Num2Bits(64);
    n2b.in <== amount;

    component isz = IsZero();
    isz.in <== amount;
    isz.out === 0;

    component poseidon = Poseidon(6);
    poseidon.inputs[0] <== instrument;
    poseidon.inputs[1] <== version;
    poseidon.inputs[2] <== amount;
    poseidon.inputs[3] <== target;
    poseidon.inputs[4] <== nonce;
    poseidon.inputs[5] <== params_hash;

    commitment <== poseidon.out;
}

// Nullifier sub-circuit
template NullifierHasher() {
    signal input nonce;
    signal input spending_key;
    signal output nullifier;

    component poseidon = Poseidon(2);
    poseidon.inputs[0] <== nonce;
    poseidon.inputs[1] <== spending_key;

    nullifier <== poseidon.out;
}

// Merkle proof sub-circuit
template MerkleTreeVerifier(depth) {
    signal input leaf;
    signal input path_elements[depth];
    signal input path_indices[depth];
    signal output root;

    signal hashes[depth + 1];
    hashes[0] <== leaf;

    component hashers[depth];

    for (var i = 0; i < depth; i++) {
        path_indices[i] * (1 - path_indices[i]) === 0;

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== hashes[i] + path_indices[i] * (path_elements[i] - hashes[i]);
        hashers[i].inputs[1] <== path_elements[i] + path_indices[i] * (hashes[i] - path_elements[i]);

        hashes[i + 1] <== hashers[i].out;
    }

    root <== hashes[depth];
}

// Full payment proof circuit
// Public: merkle_root, nullifier_hash, commitment_hash, order_id
// Private: everything else
template Payment() {
    signal input merkle_root;
    signal input nullifier_hash;
    signal input commitment_hash;
    signal input order_id;

    signal input instrument;
    signal input version;
    signal input amount;
    signal input target;
    signal input nonce;
    signal input spending_key;
    signal input params_hash;
    signal input path_elements[20];
    signal input path_indices[20];

    // 1. Verify commitment
    component comm = CommitmentHasher();
    comm.instrument <== instrument;
    comm.version <== version;
    comm.amount <== amount;
    comm.target <== target;
    comm.nonce <== nonce;
    comm.params_hash <== params_hash;
    commitment_hash === comm.commitment;

    // 2. Verify nullifier
    component nullComp = NullifierHasher();
    nullComp.nonce <== nonce;
    nullComp.spending_key <== spending_key;
    nullifier_hash === nullComp.nullifier;

    // 3. Verify Merkle inclusion
    component merkle = MerkleTreeVerifier(20);
    merkle.leaf <== comm.commitment;
    for (var i = 0; i < 20; i++) {
        merkle.path_elements[i] <== path_elements[i];
        merkle.path_indices[i] <== path_indices[i];
    }
    merkle_root === merkle.root;
}

component main {public [merkle_root, nullifier_hash, commitment_hash, order_id]} = Payment();
