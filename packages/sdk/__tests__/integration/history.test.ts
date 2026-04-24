import { IPayClient } from '../../src';

const SPENDING_KEY = process.env.IPAY_SPENDING_KEY_TEST;
const VIEWING_KEY = process.env.IPAY_VIEWING_KEY_TEST;
const CHAIN = (process.env.IPAY_CHAIN || 'initiation-2') as any;

const shouldRun = !!SPENDING_KEY && !!VIEWING_KEY;
const describeIntegration = shouldRun ? describe : describe.skip;

describeIntegration('History Integration Tests', () => {
  let client: IPayClient;

  beforeAll(() => {
    client = new IPayClient({
      chain: CHAIN,
      network: 'testnet',
      viewingKey: VIEWING_KEY!,
      spendingKey: SPENDING_KEY!,
    });
  });

  // TC-SDK-I11: History scan
  it('scans and returns history', async () => {
    const history = await client.history.getAll({ direction: 'received' });
    expect(Array.isArray(history)).toBe(true);
    if (history.length > 0) {
      expect(history[0]).toHaveProperty('amount');
      expect(history[0]).toHaveProperty('noteId');
    }
  }, 30000);

  // TC-SDK-I12: Archive + unarchive
  it('archives and unarchives a note', async () => {
    const history = await client.history.getAll();
    if (history.length === 0) return; // skip if no history

    const noteId = history[0].noteId;
    await client.history.archive([noteId]);

    const hidden = await client.history.getAll();
    expect(hidden.every((n) => n.noteId !== noteId || n.status === 'archived')).toBe(true);

    await client.history.unarchive([noteId]);

    const restored = await client.history.getAll();
    expect(restored.some((n) => n.noteId === noteId)).toBe(true);
  }, 30000);
});
