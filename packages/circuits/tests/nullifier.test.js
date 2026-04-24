const {
  getPoseidon,
  poseidonHash,
  calculateWitness,
  fullProve,
  verify,
} = require("./helpers");

const CIRCUIT = "nullifier";

describe("Nullifier Circuit", () => {
  let poseidon;

  beforeAll(async () => {
    poseidon = await getPoseidon();
  });

  // TC-N1: valid nullifier
  test("TC-N1: valid nullifier — deterministic output", async () => {
    const input = {
      nonce: BigInt("0x0bcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab").toString(),
      spending_key: BigInt("0x01111111111111111111111111111111111111111111111111111111111111111").toString(),
    };

    const { proof, publicSignals } = await fullProve(CIRCUIT, input);
    const valid = await verify(CIRCUIT, proof, publicSignals);
    expect(valid).toBe(true);

    // Deterministic: same inputs → same output
    const expected = poseidonHash(poseidon, [input.nonce, input.spending_key]);
    expect(BigInt(publicSignals[0])).toBe(expected);

    // Run again to confirm determinism
    const { publicSignals: ps2 } = await fullProve(CIRCUIT, input);
    expect(publicSignals[0]).toBe(ps2[0]);
  });

  // TC-N2: same nonce, different key → different nullifier
  test("TC-N2: same nonce, different key → different nullifier", async () => {
    const nonce = BigInt("0x0bcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab").toString();

    const inputA = {
      nonce,
      spending_key: BigInt("0x01111111111111111111111111111111111111111111111111111111111111111").toString(),
    };
    const inputB = {
      nonce,
      spending_key: BigInt("0x02222222222222222222222222222222222222222222222222222222222222222").toString(),
    };

    const { publicSignals: psA } = await fullProve(CIRCUIT, inputA);
    const { publicSignals: psB } = await fullProve(CIRCUIT, inputB);

    expect(psA[0]).not.toBe(psB[0]);
  });

  // TC-N3: different nonce, same key → different nullifier
  test("TC-N3: different nonce, same key → different nullifier", async () => {
    const spending_key = BigInt("0x01111111111111111111111111111111111111111111111111111111111111111").toString();

    const inputA = {
      nonce: BigInt("0x0bcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab").toString(),
      spending_key,
    };
    const inputB = {
      nonce: BigInt("0x0cba0987654321fedcba0987654321fedcba0987654321fedcba0987654321fe").toString(),
      spending_key,
    };

    const { publicSignals: psA } = await fullProve(CIRCUIT, inputA);
    const { publicSignals: psB } = await fullProve(CIRCUIT, inputB);

    expect(psA[0]).not.toBe(psB[0]);
  });
});
