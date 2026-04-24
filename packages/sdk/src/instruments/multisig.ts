import type { ApiClient } from '../api/client';
import type {
  MultisigCreateParams,
  MultisigResult,
  MultisigApproveParams,
  MultisigApproveResult,
  MultisigStatus,
  MultisigCancelParams,
} from '../types';
import { IPayError } from '../types/errors';

export class MultisigModule {
  constructor(
    private readonly api: ApiClient,
    private readonly hasSpendingKey: boolean,
  ) {}

  async create(params: MultisigCreateParams): Promise<MultisigResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to create multisig');
    }
    return this.api.post<MultisigResult>('/multisig', params);
  }

  async approve(params: MultisigApproveParams): Promise<MultisigApproveResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to approve multisig');
    }
    return this.api.post<MultisigApproveResult>(
      `/multisig/${encodeURIComponent(params.multisigId)}/approve`,
    );
  }

  async getStatus(multisigId: string): Promise<MultisigStatus> {
    return this.api.get<MultisigStatus>(`/multisig/${encodeURIComponent(multisigId)}`);
  }

  async cancel(params: MultisigCancelParams): Promise<{ status: 'cancelled' }> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to cancel multisig');
    }
    return this.api.delete<{ status: 'cancelled' }>(
      `/multisig/${encodeURIComponent(params.multisigId)}`,
    );
  }
}
