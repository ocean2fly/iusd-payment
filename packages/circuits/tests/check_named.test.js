const {
  getPoseidon,
  poseidonHash,
  calculateWitness,
  fullProve,
  verify,
  buildMerkleTree,
} = require("./helpers");

const CIRCUIT = "check_named";

describe("Check Named Circuit", () => {
  let poseidon;
  let validInput;

  beforeAll(async () => {
    poseidon = await getPoseidon();

    const version = 1;
    const amount = 5000000;
    const target = BigInt("0x0aabbccdd1234567890abcdef1234567890abcdef1234567890abcdef1234567"); // recipient stealth addr
    const nonce = BigInt("0x0f0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd");
    const spending_key = BigInt("0x01111111111111111111111111111111111111111111111111111111111111111");
    const params_hash = BigInt(0);
    const check_id = BigInt(77777);

    const commitment = poseidonHash(poseidon, [
      2, // instrument = check
      version,
      amount,
      target,
      nonce,
      params_hash,
    ]);

    const nullifierVal = poseidonHash(poseidon, [nonce, spending_key]);
    const merkleData = await buildMerkleTree(poseidon, commitment, 0);

    validInput = {
      merkle_root: merkleData.root.toString(),
      nullifier_hash: nullifierVal.toString(),
      check_id: check_id.toString(),
      recipient_stealth_addr: target.toString(),
      nonce: nonce.toString(),
      spending_key: spending_key.toString(),
      amount: amount.toString(),
      target: target.toString(),
      version: version.toString(),
      params_hash: params_hash.toString(),
      path_elements: merkleData.pathElements.map((e) => e.toString()),
      path_indices: merkleData.pathIndices,
    };
  });

  // TC-CN1: valid named check claim
  test("TC-CN1: valid named check claim", async () => {
    const { proof, publicSignals } = await fullProve(CIRCUIT, validInput);
    const valid = await verify(CIRCUIT, proof, publicSignals);
    expect(valid).toBe(true);
  });

  // TC-CN2: wrong recipient — must FAIL
  test("TC-CN2: wrong recipient must fail", async () => {
    const attackerAddr = BigInt("0x0deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567");
    const badInput = {
      ...validInput,
      recipient_stealth_addr: attackerAddr.toString(),
      // target still equals the original, so target !== recipient_stealth_addr
    };
    await expect(calculateWitness(CIRCUIT, badInput)).rejects.toThrow();
  });
});
