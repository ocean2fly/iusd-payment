const {
  getPoseidon,
  poseidonHash,
  calculateWitness,
  fullProve,
  verify,
  buildMerkleTree,
} = require("./helpers");

const CIRCUIT = "merkle_proof";

describe("Merkle Proof Circuit", () => {
  let poseidon;

  beforeAll(async () => {
    poseidon = await getPoseidon();
  });

  // TC-M1: valid inclusion proof
  test("TC-M1: valid inclusion proof", async () => {
    const leaf = poseidonHash(poseidon, [12345]);
    const { root, pathElements, pathIndices } = await buildMerkleTree(
      poseidon,
      leaf,
      0
    );

    const input = {
      leaf: leaf.toString(),
      path_elements: pathElements.map((e) => e.toString()),
      path_indices: pathIndices,
      root: root.toString(),
    };

    const { proof, publicSignals } = await fullProve(CIRCUIT, input);
    const valid = await verify(CIRCUIT, proof, publicSignals);
    expect(valid).toBe(true);
  });

  // TC-M2: wrong root — must FAIL
  test("TC-M2: wrong root must fail", async () => {
    const leaf = poseidonHash(poseidon, [12345]);
    const { pathElements, pathIndices } = await buildMerkleTree(
      poseidon,
      leaf,
      0
    );

    const input = {
      leaf: leaf.toString(),
      path_elements: pathElements.map((e) => e.toString()),
      path_indices: pathIndices,
      root: "0", // wrong root
    };

    await expect(calculateWitness(CIRCUIT, input)).rejects.toThrow();
  });

  // TC-M3: tampered path — must FAIL
  test("TC-M3: tampered path must fail", async () => {
    const leaf = poseidonHash(poseidon, [12345]);
    const { root, pathElements, pathIndices } = await buildMerkleTree(
      poseidon,
      leaf,
      0
    );

    // Tamper with path element at index 5
    const tamperedPath = [...pathElements.map((e) => e.toString())];
    tamperedPath[5] = BigInt("0x0dead").toString();

    const input = {
      leaf: leaf.toString(),
      path_elements: tamperedPath,
      path_indices: pathIndices,
      root: root.toString(),
    };

    await expect(calculateWitness(CIRCUIT, input)).rejects.toThrow();
  });

  // TC-M4: leftmost leaf (all indices = 0)
  test("TC-M4: leftmost leaf, depth 20", async () => {
    const leaf = poseidonHash(poseidon, [99999]);
    const { root, pathElements, pathIndices } = await buildMerkleTree(
      poseidon,
      leaf,
      0 // leftmost = index 0
    );

    // Verify all path_indices are 0
    expect(pathIndices.every((i) => i === 0)).toBe(true);

    const input = {
      leaf: leaf.toString(),
      path_elements: pathElements.map((e) => e.toString()),
      path_indices: pathIndices,
      root: root.toString(),
    };

    const { proof, publicSignals } = await fullProve(CIRCUIT, input);
    const valid = await verify(CIRCUIT, proof, publicSignals);
    expect(valid).toBe(true);
  });

  // TC-M5: rightmost leaf (all indices = 1)
  test("TC-M5: rightmost leaf, depth 20", async () => {
    const leaf = poseidonHash(poseidon, [77777]);
    const rightmostIndex = (1 << 20) - 1; // 2^20 - 1 = all 1s
    const { root, pathElements, pathIndices } = await buildMerkleTree(
      poseidon,
      leaf,
      rightmostIndex
    );

    // Verify all path_indices are 1
    expect(pathIndices.every((i) => i === 1)).toBe(true);

    const input = {
      leaf: leaf.toString(),
      path_elements: pathElements.map((e) => e.toString()),
      path_indices: pathIndices,
      root: root.toString(),
    };

    const { proof, publicSignals } = await fullProve(CIRCUIT, input);
    const valid = await verify(CIRCUIT, proof, publicSignals);
    expect(valid).toBe(true);
  });
});
