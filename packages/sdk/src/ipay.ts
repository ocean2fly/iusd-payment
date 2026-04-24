import type { IPayClientConfig, Chain, Network } from './types';
import { ApiClient } from './api/client';
import { PaymentModule } from './instruments/payment';
import { SubscriptionModule } from './instruments/subscription';
import { CheckModule } from './instruments/check';
import { MultisigModule } from './instruments/multisig';
import { ConditionalModule } from './instruments/conditional';
import { InvoiceModule } from './instruments/invoice';
import { HistoryModule } from './history';
import { ComplianceModule } from './compliance';
import { AddressModule } from './address';
import { WebhookModule } from './webhook';

const DEFAULT_API_URL = 'https://api.iusd-pay.xyz/v1';

export class IPayClient {
  readonly payment: PaymentModule;
  readonly subscription: SubscriptionModule;
  readonly check: CheckModule;
  readonly multisig: MultisigModule;
  readonly conditional: ConditionalModule;
  readonly invoice: InvoiceModule;
  readonly history: HistoryModule;
  readonly compliance: ComplianceModule;
  readonly address: AddressModule;
  readonly webhook: WebhookModule;
  readonly network: Network;
  readonly chain: Chain;

  constructor(config: IPayClientConfig) {
    const apiUrl = config.apiUrl || DEFAULT_API_URL;
    const hasSpendingKey = !!config.spendingKey;
    this.network = config.network || 'mainnet';
    this.chain = config.chain;

    const api = new ApiClient({
      baseUrl: apiUrl,
      viewingKey: config.viewingKey,
      spendingKey: config.spendingKey,
    });

    this.payment = new PaymentModule(api, config.chain, hasSpendingKey);
    this.subscription = new SubscriptionModule(api, hasSpendingKey);
    this.check = new CheckModule(api, hasSpendingKey);
    this.multisig = new MultisigModule(api, hasSpendingKey);
    this.conditional = new ConditionalModule(api, hasSpendingKey);
    this.invoice = new InvoiceModule(api, hasSpendingKey);
    this.history = new HistoryModule(api, hasSpendingKey);
    this.compliance = new ComplianceModule(api);
    this.address = new AddressModule(api);
    this.webhook = new WebhookModule(api);
  }
}
