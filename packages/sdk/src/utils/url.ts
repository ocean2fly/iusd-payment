import type { PaymentUrlParams, ParsedPaymentUrl } from '../types';

export function buildPaymentUrl(params: PaymentUrlParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set('to', params.to);
  searchParams.set('amount', params.amount);
  if (params.orderId) searchParams.set('ref', params.orderId);
  if (params.chain) searchParams.set('chain', params.chain);
  if (params.memo) searchParams.set('memo', params.memo);
  if (params.expires !== undefined) searchParams.set('expires', params.expires.toString());
  return `ipay://?${searchParams.toString()}`;
}

export function parsePaymentUrl(url: string): ParsedPaymentUrl {
  const queryString = url.replace(/^ipay:\/\/\?/, '');
  const params = new URLSearchParams(queryString);

  const result: ParsedPaymentUrl = {
    to: params.get('to') || '',
    amount: params.get('amount') || '',
  };

  const ref = params.get('ref');
  if (ref) result.orderId = ref;

  const chain = params.get('chain');
  if (chain) result.chain = chain;

  const memo = params.get('memo');
  if (memo) result.memo = memo;

  const expires = params.get('expires');
  if (expires) result.expires = parseInt(expires, 10);

  return result;
}
