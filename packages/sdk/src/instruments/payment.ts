import type { ApiClient } from '../api/client';
import type {
  Chain,
  SendParams,
  PaymentResult,
  PaymentStatus,
  PaymentLink,
  CreateLinkParams,
  ScanParams,
  DiscoveredPayment,
  RecoverParams,
} from '../types';
import { IPayError } from '../types/errors';

export class PaymentModule {
  constructor(
    private readonly api: ApiClient,
    private readonly defaultChain: Chain,
    private readonly hasSpendingKey: boolean,
  ) {}

  async send(params: SendParams): Promise<PaymentResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to send payments');
    }
    const chain = params.chain || this.defaultChain;
    return this.api.post<PaymentResult>('/payments', {
      to: params.to,
      amount: params.amount,
      chain,
      memo: params.memo,
      orderId: params.orderId,
      expiresAt: params.expiresAt,
    });
  }

  async createLink(params: CreateLinkParams): Promise<PaymentLink> {
    const chain = params.chain || this.defaultChain;
    return this.api.post<PaymentLink>('/payments/link', {
      amount: params.amount,
      orderId: params.orderId,
      chain,
      memo: params.memo,
      expires: params.expires,
    });
  }

  async getStatus(orderId: string): Promise<PaymentStatus> {
    return this.api.get<PaymentStatus>(`/payments/${encodeURIComponent(orderId)}`);
  }

  async scan(params?: ScanParams): Promise<DiscoveredPayment[]> {
    const queryParams: Record<string, string> = {};
    if (params?.fromBlock !== undefined) queryParams.fromBlock = params.fromBlock.toString();
    if (params?.toBlock !== undefined) queryParams.toBlock = params.toBlock.toString();
    return this.api.get<DiscoveredPayment[]>('/payments/scan', queryParams);
  }

  async recover(params: RecoverParams): Promise<PaymentResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to recover payments');
    }
    return this.api.post<PaymentResult>('/payments/recover', params);
  }
}
