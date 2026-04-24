import type { ApiClient } from '../api/client';
import type {
  InvoiceCreateParams,
  InvoiceResult,
  InvoicePayParams,
  InvoiceDetails,
  TxResult,
} from '../types';
import { IPayError } from '../types/errors';

export class InvoiceModule {
  constructor(
    private readonly api: ApiClient,
    private readonly hasSpendingKey: boolean,
  ) {}

  async create(params: InvoiceCreateParams): Promise<InvoiceResult> {
    return this.api.post<InvoiceResult>('/invoices', params);
  }

  async get(invoiceId: string): Promise<InvoiceDetails> {
    return this.api.get<InvoiceDetails>(`/invoices/${encodeURIComponent(invoiceId)}`);
  }

  async pay(params: InvoicePayParams): Promise<TxResult> {
    if (!this.hasSpendingKey) {
      throw new IPayError('E_MISSING_SPENDING_KEY', 'Spending key required to pay invoices');
    }
    return this.api.post<TxResult>(
      `/invoices/${encodeURIComponent(params.invoiceId)}/pay`,
    );
  }

  async listMy(): Promise<InvoiceResult[]> {
    return this.api.get<InvoiceResult[]>('/invoices');
  }
}
