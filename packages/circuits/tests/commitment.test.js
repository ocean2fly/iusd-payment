const {
  getPoseidon,
  poseidonHash,
  calculateWitness,
  fullProve,
  verify,
} = require("./helpers");

const CIRCUIT = "commitment";

describe("Commitment Circuit", () => {
  let poseidon;

  beforeAll(async () => {
    poseidon = await getPoseidon();
  });

  // TC-C1: basic payment commitment
  test("TC-C1: basic payment commitment", async () => {
    const input = {
      instrument: 0,
      version: 1,
      amount: 50000000,
      target: BigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef").toString(),
      nonce: BigInt("0x0bcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab").toString(),
      params_hash: 0,
    };

    const { proof, publicSignals } = await fullProve(CIRCUIT, input);
    const valid = await verify(CIRCUIT, proof, publicSignals);
    expect(valid).toBe(true);

    // Verify the output matches JS-side Poseidon
    const expectedCommitment = poseidonHash(poseidon, [
      input.instrument,
      input.version,
      input.amount,
      input.target,
      input.nonce,
      input.params_hash,
    ]);
    expect(BigInt(publicSignals[0])).toBe(expectedCommitment);
  });

  // TC-C2: subscription commitment (instrument=1)
  test("TC-C2: subscription commitment, instrument=1", async () => {
    const paramsHash = poseidonHash(poseidon, [12, 2592000]);

    const input = {
      instrument: 1,
      version: 1,
      amount: 10000000,
      target: BigInt("0x05678abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345").toString(),
      nonce: BigInt("0x0f0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd").toString(),
      params_hash: paramsHash.toString(),
    };

    const { proof, publicSignals } = await fullProve(CIRCUIT, input);
    const valid = await verify(CIRCUIT, proof, publicSignals);
    expect(valid).toBe(true);

    // Commitment must be distinct from TC-C1 (different inputs → different hash)
    const input1 = {
      instrument: 0,
      version: 1,
      amount: 50000000,
      target: BigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef").toString(),
      nonce: BigInt("0x0bcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab").toString(),
      params_hash: 0,
    };
    const { publicSignals: ps1 } = await fullProve(CIRCUIT, input1);
    expect(publicSignals[0]).not.toBe(ps1[0]);
  });

  // TC-C3: zero amount — must FAIL
  test("TC-C3: zero amount must fail", async () => {
    const input = {
      instrument: 0,
      version: 1,
      amount: 0,
      target: BigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef").toString(),
      nonce: BigInt("0x0bcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab").toString(),
      params_hash: 0,
    };

    await expect(calculateWitness(CIRCUIT, input)).rejects.toThrow();
  });

  // TC-C4: amount overflow (2^64) — must FAIL
  test("TC-C4: amount overflow must fail", async () => {
    const input = {
      instrument: 0,
      version: 1,
      amount: (BigInt(2) ** BigInt(64)).toString(),
      target: BigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef").toString(),
      nonce: BigInt("0x0bcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab").toString(),
      params_hash: 0,
    };

    await expect(calculateWitness(CIRCUIT, input)).rejects.toThrow();
  });
});
