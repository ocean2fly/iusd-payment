import { buildPaymentUrl, parsePaymentUrl } from '../../src/utils/url';

// TC-SDK-U10: Payment URL generation
describe('buildPaymentUrl', () => {
  it('builds correct ipay:// URL', () => {
    const url = buildPaymentUrl({
      to: 'merchant.init',
      amount: '50000000',
      orderId: 'ORD-001',
    });
    expect(url).toBe('ipay://?to=merchant.init&amount=50000000&ref=ORD-001');
  });

  it('includes optional fields', () => {
    const url = buildPaymentUrl({
      to: 'alice.init',
      amount: '1000000',
      chain: 'interwoven-1',
      memo: 'test',
      expires: 3600,
    });
    expect(url).toContain('to=alice.init');
    expect(url).toContain('amount=1000000');
    expect(url).toContain('chain=interwoven-1');
    expect(url).toContain('memo=test');
    expect(url).toContain('expires=3600');
  });
});

// TC-SDK-U11: Payment URL parsing
describe('parsePaymentUrl', () => {
  it('parses all fields correctly', () => {
    const params = parsePaymentUrl(
      'ipay://?to=merchant.init&amount=50000000&ref=ORD-001&expires=3600',
    );
    expect(params.to).toBe('merchant.init');
    expect(params.amount).toBe('50000000');
    expect(params.orderId).toBe('ORD-001');
    expect(params.expires).toBe(3600);
  });

  it('handles missing optional fields', () => {
    const params = parsePaymentUrl('ipay://?to=alice.init&amount=1000');
    expect(params.to).toBe('alice.init');
    expect(params.amount).toBe('1000');
    expect(params.orderId).toBeUndefined();
    expect(params.expires).toBeUndefined();
  });
});
