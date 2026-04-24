pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Merkle tree inclusion proof with Poseidon hash, depth=20
template MerkleProof(depth) {
    signal input leaf;
    signal input path_elements[depth];
    signal input path_indices[depth]; // 0 = left child, 1 = right child
    signal input root;

    signal hashes[depth + 1];
    hashes[0] <== leaf;

    component hashers[depth];

    for (var i = 0; i < depth; i++) {
        // path_indices[i] must be binary
        path_indices[i] * (1 - path_indices[i]) === 0;

        hashers[i] = Poseidon(2);
        // If path_indices[i] == 0: current is left, sibling is right → hash(current, sibling)
        // If path_indices[i] == 1: current is right, sibling is left → hash(sibling, current)
        hashers[i].inputs[0] <== hashes[i] + path_indices[i] * (path_elements[i] - hashes[i]);
        hashers[i].inputs[1] <== path_elements[i] + path_indices[i] * (hashes[i] - path_elements[i]);

        hashes[i + 1] <== hashers[i].out;
    }

    // Constrain computed root to match expected root
    root === hashes[depth];
}

component main {public [root]} = MerkleProof(20);
