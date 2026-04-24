import type { ApiClient } from '../api/client';
import type {
  ComplianceRecord,
  ComplianceReportParams,
  ComplianceReport,
  TravelRulePacketParams,
  RetentionStatus,
} from '../types';

export class ComplianceModule {
  constructor(private readonly api: ApiClient) {}

  async getRecord(orderId: string): Promise<ComplianceRecord> {
    return this.api.get<ComplianceRecord>(`/compliance/${encodeURIComponent(orderId)}`);
  }

  async generateReport(params: ComplianceReportParams): Promise<ComplianceReport> {
    return this.api.post<ComplianceReport>('/compliance/report', params);
  }

  async generateTravelRulePacket(params: TravelRulePacketParams): Promise<Uint8Array> {
    const result = await this.api.post<{ data: string }>('/compliance/travel-rule', params);
    const binaryStr = atob(result.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  }

  async listRetentionStatus(): Promise<RetentionStatus[]> {
    return this.api.get<RetentionStatus[]>('/compliance/retention');
  }
}
