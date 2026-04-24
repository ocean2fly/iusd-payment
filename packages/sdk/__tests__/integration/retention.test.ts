import { IPayClient, IPayError } from '../../src';

const SPENDING_KEY = process.env.IPAY_SPENDING_KEY_TEST;
const VIEWING_KEY = process.env.IPAY_VIEWING_KEY_TEST;
const CHAIN = (process.env.IPAY_CHAIN || 'initiation-2') as any;

const shouldRun = !!SPENDING_KEY && !!VIEWING_KEY;
const describeIntegration = shouldRun ? describe : describe.skip;

// TC-SDK-I13: Destroy — retention period active
describeIntegration('Retention Integration Tests', () => {
  let client: IPayClient;

  beforeAll(() => {
    client = new IPayClient({
      chain: CHAIN,
      network: 'testnet',
      viewingKey: VIEWING_KEY!,
      spendingKey: SPENDING_KEY!,
    });
  });

  it('rejects destroy when retention period is active', async () => {
    const history = await client.history.getAll();
    if (history.length === 0) return; // skip if no history

    const noteId = history[0].noteId;

    try {
      await client.history.destroy([noteId]);
      fail('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(IPayError);
      expect(err.code).toBe('E_RETENTION_PERIOD_ACTIVE');
    }
  }, 15000);
});
