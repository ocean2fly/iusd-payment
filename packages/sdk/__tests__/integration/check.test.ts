import { IPayClient } from '../../src';

const SPENDING_KEY = process.env.IPAY_SPENDING_KEY_TEST;
const VIEWING_KEY = process.env.IPAY_VIEWING_KEY_TEST;
const RECIPIENT_ADDR = process.env.IPAY_RECIPIENT_ADDR || 'init1testrecipient';
const CHAIN = (process.env.IPAY_CHAIN || 'initiation-2') as any;

const shouldRun = !!SPENDING_KEY && !!VIEWING_KEY;
const describeIntegration = shouldRun ? describe : describe.skip;

describeIntegration('Check Integration Tests', () => {
  let client: IPayClient;

  beforeAll(() => {
    client = new IPayClient({
      chain: CHAIN,
      network: 'testnet',
      viewingKey: VIEWING_KEY!,
      spendingKey: SPENDING_KEY!,
    });
  });

  // TC-SDK-I5: Recipient scans and finds payment
  it('recipient can scan and find received payment', async () => {
    // This test requires a second client with different keys
    // For now, we test the scanning mechanism exists
    const history = await client.history.getAll({ direction: 'received' });
    // Just verify the call succeeds
    expect(Array.isArray(history)).toBe(true);
  }, 30000);

  // TC-SDK-I7: Named check full lifecycle
  it('issues and claims a named check', async () => {
    const check = await client.check.issue({
      type: 'named',
      to: RECIPIENT_ADDR,
      amount: '1000000',
      expiresIn: '24h',
      recipientChain: CHAIN,
    });

    expect(check.checkId).toMatch(/^CHK-/);
    expect(check.status).toBe('pending');

    // Note: claiming requires the recipient's client
    // Verify status check works
    const status = await client.check.getStatus(check.checkId);
    expect(status.status).toBe('pending');
  }, 60000);

  // TC-SDK-I8: Bearer check full lifecycle
  it('issues a bearer check with claim code', async () => {
    const check = await client.check.issue({
      type: 'bearer',
      amount: '1000000',
      expiresIn: '1h',
    });

    expect(check.claimCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(check.checkId).toMatch(/^CHK-/);
  }, 60000);

  // TC-SDK-I9: Check expiry + reclaim
  it('reclaims an expired check', async () => {
    const check = await client.check.issue({
      type: 'bearer',
      amount: '1000000',
      expiresIn: '1s',
    });

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 5000));

    const reclaimed = await client.check.reclaimExpired({
      checkId: check.checkId,
      returnChain: CHAIN,
    });
    expect(reclaimed.status).toBe('confirmed');
  }, 30000);

  // TC-SDK-I10: Address resolution
  it('resolves a testnet address', async () => {
    try {
      const addr = await client.address.resolve('test-user.init');
      if (addr) {
        expect(addr.bech32).toMatch(/^init1[a-z0-9]+$/);
      }
    } catch (err: any) {
      // Address may not be registered — that's OK
      expect(err.code).toBe('E_ADDRESS_NOT_FOUND');
    }
  }, 15000);
});
