import type { ApiClient } from '../api/client';
import type {
  CheckIssueParams,
  IssuedCheck,
  CheckClaimParams,
  CheckClaimBearerParams,
  CheckCancelParams,
  CheckReclaimParams,
  CheckStatus,
  TxResult,
} from '../types';
import { IPayError } from '../types/errors';

export class CheckModule {
  constructor(
    private readonly api: ApiClient,
    private readonly hasSpendingKey: boolean,
  ) {}

  async issue(params: CheckIssueParams): Promise<IssuedCheck> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to issue checks');
    }
    return this.api.post<IssuedCheck>('/checks', params);
  }

  async claim(params: CheckClaimParams): Promise<TxResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to claim checks');
    }
    return this.api.post<TxResult>(
      `/checks/${encodeURIComponent(params.checkId)}/claim`,
      { recipientChain: params.recipientChain },
    );
  }

  async claimBearer(params: CheckClaimBearerParams): Promise<TxResult> {
    return this.api.post<TxResult>(
      `/checks/${encodeURIComponent(params.checkId)}/claim`,
      { claimCode: params.claimCode, recipientChain: params.recipientChain },
    );
  }

  async cancel(params: CheckCancelParams): Promise<{ status: 'cancelled' }> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to cancel checks');
    }
    return this.api.delete<{ status: 'cancelled' }>(
      `/checks/${encodeURIComponent(params.checkId)}`,
    );
  }

  async reclaimExpired(params: CheckReclaimParams): Promise<TxResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to reclaim checks');
    }
    return this.api.post<TxResult>(
      `/checks/${encodeURIComponent(params.checkId)}/reclaim`,
      { returnChain: params.returnChain },
    );
  }

  async getStatus(checkId: string): Promise<CheckStatus> {
    return this.api.get<CheckStatus>(`/checks/${encodeURIComponent(checkId)}`);
  }

  async listIssued(): Promise<IssuedCheck[]> {
    return this.api.get<IssuedCheck[]>('/checks/issued');
  }

  async listReceived(): Promise<IssuedCheck[]> {
    return this.api.get<IssuedCheck[]>('/checks/received');
  }
}
