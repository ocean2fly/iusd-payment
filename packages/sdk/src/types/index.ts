export type Chain =
  | 'interwoven-1'
  | 'echelon-1'
  | 'inertia'
  | 'moo-1'
  | 'intergaze'
  | 'initiation-2'
  | 'minimove-1';

export type Network = 'mainnet' | 'testnet';
export type Amount = string;
export type Address = string;
export type Hex = string;
export type InstrumentType = 0 | 1 | 2 | 3 | 4 | 5;

export type ChainType = 'cosmos' | 'move' | 'cosmwasm';

export interface ChainConfig {
  id: Chain;
  name: string;
  type: ChainType;
  network: Network;
  rpc?: string;
  ibcChannel?: string | null;
}

export interface MetaAddress {
  pkSpend: string;
  pkView: string;
}

export interface KeyPair {
  spendingKey: string;
  viewingKey: string;
  metaAddress: MetaAddress;
  address: string;
}

export interface KeyPairOptions {
  seed?: string;
}

export interface IPayClientConfig {
  chain: Chain;
  network?: Network;
  viewingKey: string;
  spendingKey?: string;
  apiUrl?: string;
}

export interface PaymentResult {
  orderId: string;
  nullifier: string;
  status: 'confirmed' | 'failed';
  txHash?: string;
}

export interface PaymentStatus {
  orderId: string;
  status: 'pending' | 'confirmed' | 'expired' | 'failed';
  nullifier?: string;
  instrumentType: InstrumentType;
  recipientChain: string;
  createdAt: number;
  confirmedAt?: number;
}

export interface SendParams {
  to: Address;
  amount: Amount;
  chain?: Chain;
  memo?: string;
  orderId?: string;
  expiresAt?: number;
}

export interface PaymentLink {
  url: string;
  qrData: string;
  expiresAt: number;
}

export interface CreateLinkParams {
  amount: Amount;
  orderId?: string;
  chain?: Chain;
  memo?: string;
  expires?: number;
}

export interface ScanParams {
  fromBlock?: number;
  toBlock?: number | 'latest';
}

export interface DiscoveredPayment {
  orderId: string;
  amount: Amount;
  stealthAddr: string;
  ephemeralPubkey: string;
  createdAt: number;
  chain: Chain;
}

export interface RecoverParams {
  orderId: string;
  returnChain: Chain;
}

export interface SubscriptionCreateParams {
  merchant: Address;
  amountPerPeriod: Amount;
  interval: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
  intervalSecs?: number;
  maxPeriods?: number;
  merchantChain: Chain;
  startTime?: number;
}

export interface SubscriptionResult {
  subscriptionId: string;
  status: 'active';
  amountPerPeriod: Amount;
  interval: string;
  intervalSecs: number;
  maxPeriods: number | null;
  paidPeriods: number;
  totalLocked: Amount;
  nextClaimableAt: number;
  createdAt: number;
}

export interface ClaimPeriodParams {
  subscriptionId: string;
  period: number;
  recipientChain: Chain;
}

export interface CancelSubscriptionParams {
  subscriptionId: string;
}

export interface SubscriptionStatus {
  subscriptionId: string;
  status: 'active' | 'paused' | 'cancelled' | 'completed';
  interval: string;
  intervalSecs: number;
  maxPeriods: number | null;
  paidPeriods: number;
  nextClaimableAt: number;
  createdAt: number;
  lastClaimedAt?: number;
}

export interface CheckIssueParams {
  type: 'named' | 'bearer';
  to?: Address;
  amount: Amount;
  expiresIn: string | number;
  recipientChain?: Chain;
  memo?: string;
}

export interface IssuedCheck {
  checkId: string;
  type: 'named' | 'bearer';
  claimCode?: string;
  issuedAt: number;
  expiresAt: number;
  status: 'pending';
}

export interface CheckClaimParams {
  checkId: string;
  recipientChain: Chain;
}

export interface CheckClaimBearerParams {
  checkId: string;
  claimCode: string;
  recipientChain: Chain;
}

export interface CheckCancelParams {
  checkId: string;
}

export interface CheckReclaimParams {
  checkId: string;
  returnChain?: Chain;
}

export interface CheckStatus {
  checkId: string;
  type: 'named' | 'bearer';
  status: 'pending' | 'claimed' | 'cancelled' | 'expired' | 'reclaimed';
  issuedAt: number;
  expiresAt: number;
  nullifier?: string | null;
  claimedAt?: number | null;
}

export interface MultisigCreateParams {
  to: Address;
  amount: Amount;
  threshold: number;
  approvers: Address[];
  chain: Chain;
  expiresIn?: string | number;
  memo?: string;
}

export interface MultisigResult {
  multisigId: string;
  threshold: number;
  approverCount: number;
  approvalCount: number;
  status: 'pending' | 'approved' | 'expired' | 'cancelled';
  expiresAt: number | null;
  createdAt: number;
}

export interface MultisigApproveParams {
  multisigId: string;
}

export interface MultisigApproveResult {
  approvalCount: number;
  status: 'pending' | 'approved';
  txHash?: string;
}

export interface MultisigStatus {
  multisigId: string;
  threshold: number;
  approverCount: number;
  approvalCount: number;
  status: 'pending' | 'approved' | 'expired' | 'cancelled';
  expiresAt: number | null;
  createdAt: number;
  settledAt: number | null;
}

export interface MultisigCancelParams {
  multisigId: string;
}

export interface ConditionalHashlockParams {
  to: Address;
  amount: Amount;
  secret: string;
  chain: Chain;
  expiresIn: string | number;
  memo?: string;
}

export interface ConditionalHashlockResult {
  condId: string;
  secretHash: string;
}

export interface ReleaseHashlockParams {
  condId: string;
  secret: string;
}

export interface ConditionalEscrowParams {
  to: Address;
  amount: Amount;
  chain: Chain;
  expiresIn: string | number;
  memo?: string;
}

export interface ConditionalEscrowResult {
  condId: string;
}

export interface ConfirmEscrowParams {
  condId: string;
  role: 'payer' | 'recipient';
}

export interface ConditionalTimelockParams {
  to: Address;
  amount: Amount;
  chain: Chain;
  unlockTime: number;
  memo?: string;
}

export interface ConditionalTimelockResult {
  condId: string;
  unlockTime: number;
}

export interface ReleaseTimelockParams {
  condId: string;
}

export interface ConditionalRefundParams {
  condId: string;
}

export interface ConditionalStatus {
  condId: string;
  type: 'hashlock' | 'escrow' | 'timelock';
  status: 'pending' | 'released' | 'refunded' | 'expired';
  expiresAt: number;
  createdAt: number;
  releasedAt: number | null;
}

export interface InvoiceCreateParams {
  billTo: Address;
  dueDate: number;
  items: LineItem[];
  currency?: 'iUSD';
  memo?: string;
  chain: Chain;
  invoiceNumber?: string;
}

export interface LineItem {
  description: string;
  amount: Amount;
}

export interface InvoiceResult {
  invoiceId: string;
  merchant: string;
  billTo: string;
  total: Amount;
  dueDate: number;
  status: 'unpaid' | 'paid' | 'overdue' | 'cancelled';
  paymentUrl: string;
  createdAt: number;
}

export interface InvoicePayParams {
  invoiceId: string;
}

export interface InvoiceDetails extends InvoiceResult {
  items?: LineItem[];
  paidAt?: number | null;
  paymentOrderId?: string | null;
}

export interface HistoryGetAllParams {
  instrument?: InstrumentType;
  direction?: 'sent' | 'received';
  fromTime?: number;
  toTime?: number;
  status?: 'active' | 'spent' | 'archived';
  limit?: number;
  offset?: number;
}

export interface HistoryRecord {
  noteId: string;
  instrument: InstrumentType;
  instrumentName: string;
  orderId: string;
  amount: Amount;
  direction: 'sent' | 'received';
  status: 'active' | 'spent' | 'archived';
  chain: Chain;
  memo?: string;
  counterparty?: string;
  createdAt: number;
  spentAt?: number | null;
}

export interface DestroyAllResult {
  destroyed: number;
  skipped: number;
}

export interface ComplianceRecord {
  orderId: string;
  nullifier: string;
  instrumentType: InstrumentType;
  recipientChain: string;
  timestamp: number;
  status: string;
}

export interface ComplianceReportParams {
  orderId: string;
  recipientPublicKey?: string;
}

export interface ComplianceReport {
  orderId: string;
  nullifier: string;
  instrumentType: InstrumentType;
  amount: Amount;
  amountFormatted: string;
  payer: string;
  recipient: string;
  recipientChain: string;
  timestamp: number;
  viewingKeyHash: string;
  signature: string;
  encryptedFor?: string;
}

export interface TravelRulePacketParams {
  orderId: string;
  originatorVasp: string;
  beneficiaryVasp: string;
  regulatorPublicKey: string;
}

export interface RetentionStatus {
  noteId: string;
  orderId: string;
  createdAt: number;
  retentionExpiresAt: number;
  canDelete: boolean;
  daysUntilDeletable?: number;
}

export interface ResolvedAddress {
  bech32: string;
  hex: string;
  username?: string;
  metaAddress?: MetaAddress;
}

export interface AddressInfo {
  type: 'bech32' | 'hex' | 'username';
  value: string;
}

export interface WebhookRegisterParams {
  url: string;
  events: string[];
  secret?: string;
}

export interface WebhookResult {
  webhookId: string;
  url: string;
  events: string[];
  createdAt: number;
}

export interface CommitmentParams {
  instrument: InstrumentType;
  version: number;
  amount: Amount;
  target: string;
  nonce: string;
  paramsHash?: string;
}

export interface StealthResult {
  stealthAddr: string;
  ephemeralPubkey: string;
}

export interface Announcement {
  stealthAddr: string;
  ephemeralPubkey: string;
  orderId?: string;
}

export interface PaymentUrlParams {
  to: Address;
  amount: Amount;
  orderId?: string;
  chain?: Chain;
  memo?: string;
  expires?: number;
}

export interface ParsedPaymentUrl {
  to: string;
  amount: string;
  orderId?: string;
  chain?: string;
  memo?: string;
  expires?: number;
}

export interface ZKProof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: 'groth16';
  curve: 'bn254';
}

export interface TxResult {
  orderId: string;
  nullifier: string;
  proof: ZKProof;
  txHash: string;
  ibcTxHash?: string;
  chain: Chain;
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: number;
  confirmedAt: number | null;
}

export type ErrorCode =
  | 'E_NULLIFIER_SPENT'
  | 'E_INVALID_MERKLE_ROOT'
  | 'E_INSUFFICIENT_FUNDS'
  | 'E_ADDRESS_NOT_FOUND'
  | 'E_RETENTION_PERIOD_ACTIVE'
  | 'E_NOT_OWNER'
  | 'E_UNKNOWN_CHAIN'
  | 'E_INVALID_PROOF'
  | 'E_CHECK_EXPIRED'
  | 'E_CHECK_NOT_EXPIRED'
  | 'E_CHECK_CLAIMED'
  | 'E_SUBSCRIPTION_INACTIVE'
  | 'E_PERIOD_ALREADY_CLAIMED'
  | 'E_INVALID_ADDRESS'
  | 'E_INVALID_AMOUNT'
  | 'E_MISSING_SPENDING_KEY'
  | 'E_NETWORK_ERROR'
  | 'E_UNKNOWN';
