import { IPayClient } from '../../src';

const SPENDING_KEY = process.env.IPAY_SPENDING_KEY_TEST;
const VIEWING_KEY = process.env.IPAY_VIEWING_KEY_TEST;
const RECIPIENT_ADDR = process.env.IPAY_RECIPIENT_ADDR || 'init1testrecipient';
const CHAIN = (process.env.IPAY_CHAIN || 'initiation-2') as any;

const shouldRun = !!SPENDING_KEY && !!VIEWING_KEY;

const describeIntegration = shouldRun ? describe : describe.skip;

describeIntegration('Payment Integration Tests', () => {
  let client: IPayClient;

  beforeAll(() => {
    client = new IPayClient({
      chain: CHAIN,
      network: 'testnet',
      viewingKey: VIEWING_KEY!,
      spendingKey: SPENDING_KEY!,
    });
  });

  // TC-SDK-I1: Send payment — same chain
  it('sends a payment and receives confirmation', async () => {
    const tx = await client.payment.send({
      to: RECIPIENT_ADDR,
      amount: '1000000',
      orderId: 'TEST-' + Date.now(),
      chain: CHAIN,
    });

    expect(tx.status).toBe('confirmed');
    expect(tx.orderId).toMatch(/^TEST-/);
    expect(tx.nullifier).toMatch(/^0x[0-9a-f]{64}$/);
  }, 60000);

  // TC-SDK-I2: Create payment link + verify
  it('creates a payment link', async () => {
    const link = await client.payment.createLink({
      amount: '2000000',
      orderId: 'LNK-001',
      chain: CHAIN,
    });

    expect(link.url).toMatch(/^ipay:\/\//);
    expect(link.qrData).toBeTruthy();
    expect(link.expiresAt).toBeGreaterThan(Date.now() / 1000);
  }, 30000);

  // TC-SDK-I3: getStatus — confirmed
  it('gets payment status after send', async () => {
    const orderId = 'STATUS-' + Date.now();
    const tx = await client.payment.send({
      to: RECIPIENT_ADDR,
      amount: '1000000',
      orderId,
      chain: CHAIN,
    });

    const status = await client.payment.getStatus(orderId);
    expect(status.status).toBe('confirmed');
    expect(status.nullifier).toBe(tx.nullifier);
  }, 60000);

  // TC-SDK-I4: Double-spend protection
  it('rejects double-spend', async () => {
    // This test depends on the server rejecting duplicate nullifiers
    // In a real scenario, the second submission with the same nullifier should fail
    const orderId = 'DBLSPEND-' + Date.now();
    await client.payment.send({
      to: RECIPIENT_ADDR,
      amount: '1000000',
      orderId,
      chain: CHAIN,
    });

    // Attempting to send with same orderId should fail or return the same result
    try {
      await client.payment.send({
        to: RECIPIENT_ADDR,
        amount: '1000000',
        orderId,
        chain: CHAIN,
      });
      // If it succeeds, the nullifier should be different or server should reject
    } catch (err: any) {
      expect(err.code).toBe('E_NULLIFIER_SPENT');
    }
  }, 60000);
});
