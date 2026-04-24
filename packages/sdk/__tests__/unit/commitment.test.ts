import { computeCommitment, computeNullifier } from '../../src/zk';

// TC-SDK-U6: Commitment computation
describe('computeCommitment', () => {
  const baseParams = {
    instrument: 0 as const,
    version: 1,
    amount: '50000000',
    target: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    nonce: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  };

  it('produces a 32-byte hex commitment', async () => {
    const c = await computeCommitment(baseParams);
    expect(c).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is deterministic (same inputs → same commitment)', async () => {
    const c1 = await computeCommitment(baseParams);
    const c2 = await computeCommitment(baseParams);
    expect(c1).toBe(c2);
  });

  it('different inputs produce different commitments', async () => {
    const c1 = await computeCommitment(baseParams);
    const c2 = await computeCommitment({ ...baseParams, amount: '100000000' });
    expect(c1).not.toBe(c2);
  });
});

// TC-SDK-U7: Nullifier computation
describe('computeNullifier', () => {
  const nonce = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const sk1 = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const sk2 = '0x2222222222222222222222222222222222222222222222222222222222222222';

  it('produces a 32-byte hex nullifier', async () => {
    const n = await computeNullifier(nonce, sk1);
    expect(n).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('different keys produce different nullifiers', async () => {
    const n1 = await computeNullifier(nonce, sk1);
    const n2 = await computeNullifier(nonce, sk2);
    expect(n1).not.toBe(n2);
  });

  it('different nonces produce different nullifiers', async () => {
    const nonce2 = '0xdcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fe';
    const n1 = await computeNullifier(nonce, sk1);
    const n2 = await computeNullifier(nonce2, sk1);
    expect(n1).not.toBe(n2);
  });

  it('is deterministic', async () => {
    const n1 = await computeNullifier(nonce, sk1);
    const n2 = await computeNullifier(nonce, sk1);
    expect(n1).toBe(n2);
  });
});
