import type { ApiClient } from '../api/client';
import type {
  ConditionalHashlockParams,
  ConditionalHashlockResult,
  ReleaseHashlockParams,
  ConditionalEscrowParams,
  ConditionalEscrowResult,
  ConfirmEscrowParams,
  ConditionalTimelockParams,
  ConditionalTimelockResult,
  ReleaseTimelockParams,
  ConditionalRefundParams,
  ConditionalStatus,
  TxResult,
} from '../types';
import { IPayError } from '../types/errors';

export class ConditionalModule {
  constructor(
    private readonly api: ApiClient,
    private readonly hasSpendingKey: boolean,
  ) {}

  async createHashlock(params: ConditionalHashlockParams): Promise<ConditionalHashlockResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required');
    }
    return this.api.post<ConditionalHashlockResult>('/conditional/hashlock', params);
  }

  async releaseHashlock(params: ReleaseHashlockParams): Promise<TxResult> {
    return this.api.post<TxResult>(
      `/conditional/${encodeURIComponent(params.condId)}/release`,
      { secret: params.secret },
    );
  }

  async createEscrow(params: ConditionalEscrowParams): Promise<ConditionalEscrowResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required');
    }
    return this.api.post<ConditionalEscrowResult>('/conditional/escrow', params);
  }

  async confirmEscrow(params: ConfirmEscrowParams): Promise<TxResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required');
    }
    return this.api.post<TxResult>(
      `/conditional/${encodeURIComponent(params.condId)}/confirm`,
      { role: params.role },
    );
  }

  async createTimelock(params: ConditionalTimelockParams): Promise<ConditionalTimelockResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required');
    }
    return this.api.post<ConditionalTimelockResult>('/conditional/timelock', params);
  }

  async releaseTimelock(params: ReleaseTimelockParams): Promise<TxResult> {
    return this.api.post<TxResult>(
      `/conditional/${encodeURIComponent(params.condId)}/release`,
    );
  }

  async refund(params: ConditionalRefundParams): Promise<TxResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required');
    }
    return this.api.post<TxResult>(
      `/conditional/${encodeURIComponent(params.condId)}/refund`,
    );
  }

  async getStatus(condId: string): Promise<ConditionalStatus> {
    return this.api.get<ConditionalStatus>(`/conditional/${encodeURIComponent(condId)}`);
  }
}
