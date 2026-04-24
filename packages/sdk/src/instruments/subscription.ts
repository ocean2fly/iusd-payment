import type { ApiClient } from '../api/client';
import type {
  SubscriptionCreateParams,
  SubscriptionResult,
  ClaimPeriodParams,
  CancelSubscriptionParams,
  SubscriptionStatus,
  TxResult,
} from '../types';
import { IPayError } from '../types/errors';

export class SubscriptionModule {
  constructor(
    private readonly api: ApiClient,
    private readonly hasSpendingKey: boolean,
  ) {}

  async create(params: SubscriptionCreateParams): Promise<SubscriptionResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to create subscriptions');
    }
    return this.api.post<SubscriptionResult>('/subscriptions', params);
  }

  async claimPeriod(params: ClaimPeriodParams): Promise<TxResult> {
    return this.api.post<TxResult>(
      `/subscriptions/${encodeURIComponent(params.subscriptionId)}/claim/${params.period}`,
      { recipientChain: params.recipientChain },
    );
  }

  async cancel(params: CancelSubscriptionParams): Promise<{ status: 'cancelled' }> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to cancel subscriptions');
    }
    return this.api.delete<{ status: 'cancelled' }>(
      `/subscriptions/${encodeURIComponent(params.subscriptionId)}`,
    );
  }

  async getStatus(subscriptionId: string): Promise<SubscriptionStatus> {
    return this.api.get<SubscriptionStatus>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  }

  async listMy(): Promise<SubscriptionResult[]> {
    return this.api.get<SubscriptionResult[]>('/subscriptions');
  }
}
