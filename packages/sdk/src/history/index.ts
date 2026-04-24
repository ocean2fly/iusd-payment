import type { ApiClient } from '../api/client';
import type {
  HistoryGetAllParams,
  HistoryRecord,
  DestroyAllResult,
} from '../types';
import { IPayError } from '../types/errors';

export class HistoryModule {
  constructor(
    private readonly api: ApiClient,
    private readonly hasSpendingKey: boolean,
  ) {}

  async getAll(params?: HistoryGetAllParams): Promise<HistoryRecord[]> {
    const queryParams: Record<string, string> = {};
    if (params?.instrument !== undefined) queryParams.instrument = params.instrument.toString();
    if (params?.direction) queryParams.direction = params.direction;
    if (params?.fromTime !== undefined) queryParams.fromTime = params.fromTime.toString();
    if (params?.toTime !== undefined) queryParams.toTime = params.toTime.toString();
    if (params?.status) queryParams.status = params.status;
    if (params?.limit !== undefined) queryParams.limit = params.limit.toString();
    if (params?.offset !== undefined) queryParams.offset = params.offset.toString();
    return this.api.get<HistoryRecord[]>('/history', queryParams);
  }

  async getNote(orderId: string): Promise<HistoryRecord> {
    return this.api.get<HistoryRecord>(`/history/${encodeURIComponent(orderId)}`);
  }

  async archive(noteIds: string[]): Promise<void> {
    await this.api.post('/history/archive', { noteIds });
  }

  async unarchive(noteIds: string[]): Promise<void> {
    await this.api.post('/history/unarchive', { noteIds });
  }

  async destroy(noteIds: string[]): Promise<void> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to destroy notes');
    }
    await this.api.post('/history/destroy', { noteIds });
  }

  async destroyAll(): Promise<DestroyAllResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to destroy notes');
    }
    return this.api.post<DestroyAllResult>('/history/destroy-all');
  }
}
