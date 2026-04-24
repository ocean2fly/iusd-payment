const {
  getPoseidon,
  poseidonHash,
  calculateWitness,
  fullProve,
  verify,
  buildMerkleTree,
} = require("./helpers");

const CIRCUIT = "check_bearer";

describe("Check Bearer Circuit", () => {
  let poseidon;
  let validInput;

  beforeAll(async () => {
    poseidon = await getPoseidon();

    const version = 1;
    const amount = 1000000;
    // claim_code = "A7F2-K9M3-X4B1" packed as field element
    // For simplicity, we use the ASCII values packed into a single field element
    const claimCodeStr = "A7F2-K9M3-X4B1";
    let claimCodeField = BigInt(0);
    for (let i = 0; i < claimCodeStr.length; i++) {
      claimCodeField = claimCodeField * BigInt(256) + BigInt(claimCodeStr.charCodeAt(i));
    }

    const claimCodeHash = poseidonHash(poseidon, [claimCodeField]);

    const nonce = BigInt("0x0f0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd");
    const spending_key = BigInt("0x01111111111111111111111111111111111111111111111111111111111111111");
    const params_hash = BigInt(0);
    const check_id = BigInt(88888);

    // For bearer checks, target = claim_code_hash
    const commitment = poseidonHash(poseidon, [
      2, // instrument = check
      version,
      amount,
      claimCodeHash,
      nonce,
      params_hash,
    ]);

    const nullifierVal = poseidonHash(poseidon, [nonce, spending_key]);
    const merkleData = await buildMerkleTree(poseidon, commitment, 0);

    validInput = {
      merkle_root: merkleData.root.toString(),
      nullifier_hash: nullifierVal.toString(),
      check_id: check_id.toString(),
      claim_code_hash: claimCodeHash.toString(),
      nonce: nonce.toString(),
      spending_key: spending_key.toString(),
      amount: amount.toString(),
      claim_code: claimCodeField.toString(),
      version: version.toString(),
      params_hash: params_hash.toString(),
      path_elements: merkleData.pathElements.map((e) => e.toString()),
      path_indices: merkleData.pathIndices,
    };
  });

  // TC-CB1: valid bearer claim
  test("TC-CB1: valid bearer claim", async () => {
    const { proof, publicSignals } = await fullProve(CIRCUIT, validInput);
    const valid = await verify(CIRCUIT, proof, publicSignals);
    expect(valid).toBe(true);
  });

  // TC-CB2: wrong claim code — must FAIL
  test("TC-CB2: wrong claim code must fail", async () => {
    const wrongCodeStr = "XXXX-XXXX-XXXX";
    let wrongCodeField = BigInt(0);
    for (let i = 0; i < wrongCodeStr.length; i++) {
      wrongCodeField = wrongCodeField * BigInt(256) + BigInt(wrongCodeStr.charCodeAt(i));
    }

    const badInput = {
      ...validInput,
      claim_code: wrongCodeField.toString(),
    };
    // claim_code_hash won't match Poseidon(wrong_code)
    await expect(calculateWitness(CIRCUIT, badInput)).rejects.toThrow();
  });
});
