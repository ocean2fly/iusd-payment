const {
  getPoseidon,
  poseidonHash,
  calculateWitness,
  fullProve,
  verify,
  buildMerkleTree,
} = require("./helpers");

const CIRCUIT = "subscription";

describe("Subscription Circuit", () => {
  let poseidon;
  let validInput;

  beforeAll(async () => {
    poseidon = await getPoseidon();

    const version = 1;
    const amount_per_period = 10000000;
    const target = BigInt("0x05678abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345");
    const nonce = BigInt("0x0f0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd");
    const spending_key = BigInt("0x01111111111111111111111111111111111111111111111111111111111111111");
    const params_hash = poseidonHash(poseidon, [12, 2592000]);
    const subscription_id = BigInt(54321);
    const max_periods = 12;
    const current_period = 1;

    const commitment = poseidonHash(poseidon, [
      1, // instrument = subscription
      version,
      amount_per_period,
      target,
      nonce,
      params_hash,
    ]);

    const nullifierVal = poseidonHash(poseidon, [nonce, spending_key]);
    const merkleData = await buildMerkleTree(poseidon, commitment, 0);

    validInput = {
      merkle_root: merkleData.root.toString(),
      nullifier_hash: nullifierVal.toString(),
      subscription_id: subscription_id.toString(),
      nonce: nonce.toString(),
      spending_key: spending_key.toString(),
      amount_per_period: amount_per_period.toString(),
      max_periods: max_periods.toString(),
      current_period: current_period.toString(),
      target: target.toString(),
      version: version.toString(),
      params_hash: params_hash.toString(),
      path_elements: merkleData.pathElements.map((e) => e.toString()),
      path_indices: merkleData.pathIndices,
    };
  });

  // TC-S1: valid period claim (period 1 of 12)
  test("TC-S1: valid period claim — period 1 of 12", async () => {
    const { proof, publicSignals } = await fullProve(CIRCUIT, validInput);
    const valid = await verify(CIRCUIT, proof, publicSignals);
    expect(valid).toBe(true);
  });

  // TC-S2: period exceeds max — must FAIL
  test("TC-S2: period exceeds max must fail", async () => {
    const badInput = {
      ...validInput,
      current_period: "13", // max_periods = 12
    };
    await expect(calculateWitness(CIRCUIT, badInput)).rejects.toThrow();
  });

  // TC-S3: period = 0 — must FAIL
  test("TC-S3: period = 0 must fail", async () => {
    const badInput = {
      ...validInput,
      current_period: "0",
    };
    await expect(calculateWitness(CIRCUIT, badInput)).rejects.toThrow();
  });
});
