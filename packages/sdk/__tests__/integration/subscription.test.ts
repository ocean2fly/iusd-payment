import { IPayClient } from '../../src';

const SPENDING_KEY = process.env.IPAY_SPENDING_KEY_TEST;
const VIEWING_KEY = process.env.IPAY_VIEWING_KEY_TEST;
const MERCHANT_ADDR = process.env.IPAY_RECIPIENT_ADDR || 'init1testmerchant';
const CHAIN = (process.env.IPAY_CHAIN || 'initiation-2') as any;

const shouldRun = !!SPENDING_KEY && !!VIEWING_KEY;
const describeIntegration = shouldRun ? describe : describe.skip;

// TC-SDK-I6: Subscription full lifecycle
describeIntegration('Subscription Integration Tests', () => {
  let client: IPayClient;

  beforeAll(() => {
    client = new IPayClient({
      chain: CHAIN,
      network: 'testnet',
      viewingKey: VIEWING_KEY!,
      spendingKey: SPENDING_KEY!,
    });
  });

  it('creates, claims, and cancels a subscription', async () => {
    // Create subscription
    const sub = await client.subscription.create({
      merchant: MERCHANT_ADDR,
      amountPerPeriod: '500000',
      interval: 'monthly',
      maxPeriods: 3,
      merchantChain: CHAIN,
    });

    expect(sub.subscriptionId).toMatch(/^SUB-/);
    expect(sub.status).toBe('active');

    // Claim period 1
    const claim = await client.subscription.claimPeriod({
      subscriptionId: sub.subscriptionId,
      period: 1,
      recipientChain: CHAIN,
    });
    expect(claim.status).toBe('confirmed');

    // Cancel
    await client.subscription.cancel({
      subscriptionId: sub.subscriptionId,
    });

    const status = await client.subscription.getStatus(sub.subscriptionId);
    expect(status.status).toBe('cancelled');
  }, 120000);
});
