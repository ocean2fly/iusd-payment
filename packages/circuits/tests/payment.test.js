const {
  getPoseidon,
  poseidonHash,
  calculateWitness,
  fullProve,
  verify,
  buildMerkleTree,
} = require("./helpers");

const CIRCUIT = "payment";

describe("Payment Circuit", () => {
  let poseidon;
  let validInput;
  let commitment;
  let nullifierVal;
  let merkleData;

  beforeAll(async () => {
    poseidon = await getPoseidon();

    const instrument = 0;
    const version = 1;
    const amount = 50000000;
    const target = BigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
    const nonce = BigInt("0x0bcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab");
    const spending_key = BigInt("0x01111111111111111111111111111111111111111111111111111111111111111");
    const params_hash = BigInt(0);
    const order_id = BigInt(12345);

    commitment = poseidonHash(poseidon, [
      instrument, version, amount, target, nonce, params_hash,
    ]);

    nullifierVal = poseidonHash(poseidon, [nonce, spending_key]);

    merkleData = await buildMerkleTree(poseidon, commitment, 0);

    validInput = {
      merkle_root: merkleData.root.toString(),
      nullifier_hash: nullifierVal.toString(),
      commitment_hash: commitment.toString(),
      order_id: order_id.toString(),
      instrument: instrument.toString(),
      version: version.toString(),
      amount: amount.toString(),
      target: target.toString(),
      nonce: nonce.toString(),
      spending_key: spending_key.toString(),
      params_hash: params_hash.toString(),
      path_elements: merkleData.pathElements.map((e) => e.toString()),
      path_indices: merkleData.pathIndices,
    };
  });

  // TC-P1: valid payment proof
  test("TC-P1: valid payment proof", async () => {
    const { proof, publicSignals } = await fullProve(CIRCUIT, validInput);
    const valid = await verify(CIRCUIT, proof, publicSignals);
    expect(valid).toBe(true);
  });

  // TC-P2: double spend — same nullifier (contract-level test, circuit still valid)
  // This is a contract-level test. At circuit level, the same proof verifies fine.
  // We verify the proof generates the same nullifier.
  test("TC-P2: same inputs produce same nullifier (double spend detected at contract level)", async () => {
    const { publicSignals: ps1 } = await fullProve(CIRCUIT, validInput);
    const { publicSignals: ps2 } = await fullProve(CIRCUIT, validInput);

    // Same nullifier
    expect(ps1[1]).toBe(ps2[1]);
  });

  // TC-P3: wrong spending_key — must FAIL
  test("TC-P3: wrong spending_key must fail", async () => {
    const badInput = {
      ...validInput,
      spending_key: BigInt("0x09999999999999999999999999999999999999999999999999999999999999999").toString(),
    };
    // nullifier_hash was computed with original spending_key, so constraint fails
    await expect(calculateWitness(CIRCUIT, badInput)).rejects.toThrow();
  });

  // TC-P4: commitment not in tree — must FAIL
  test("TC-P4: fake Merkle path must fail", async () => {
    const fakePath = validInput.path_elements.map(() => BigInt("0x0dead").toString());
    const badInput = {
      ...validInput,
      path_elements: fakePath,
    };
    await expect(calculateWitness(CIRCUIT, badInput)).rejects.toThrow();
  });

  // TC-P5: amount mismatch — must FAIL
  test("TC-P5: amount mismatch must fail", async () => {
    // Private amount differs from what commitment was built with
    const badInput = {
      ...validInput,
      amount: "100000000", // commitment was built with 50000000
    };
    await expect(calculateWitness(CIRCUIT, badInput)).rejects.toThrow();
  });
});
