// Main client
export { IPayClient } from './ipay';

// Types
export type {
  Chain,
  Network,
  Amount,
  Address,
  Hex,
  InstrumentType,
  ChainType,
  ChainConfig,
  MetaAddress,
  KeyPair,
  KeyPairOptions,
  IPayClientConfig,
  PaymentResult,
  PaymentStatus,
  SendParams,
  PaymentLink,
  CreateLinkParams,
  ScanParams,
  DiscoveredPayment,
  RecoverParams,
  SubscriptionCreateParams,
  SubscriptionResult,
  ClaimPeriodParams,
  CancelSubscriptionParams,
  SubscriptionStatus,
  CheckIssueParams,
  IssuedCheck,
  CheckClaimParams,
  CheckClaimBearerParams,
  CheckCancelParams,
  CheckReclaimParams,
  CheckStatus,
  MultisigCreateParams,
  MultisigResult,
  MultisigApproveParams,
  MultisigApproveResult,
  MultisigStatus,
  MultisigCancelParams,
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
  InvoiceCreateParams,
  LineItem,
  InvoiceResult,
  InvoicePayParams,
  InvoiceDetails,
  HistoryGetAllParams,
  HistoryRecord,
  DestroyAllResult,
  ComplianceRecord,
  ComplianceReportParams,
  ComplianceReport,
  TravelRulePacketParams,
  RetentionStatus,
  ResolvedAddress,
  AddressInfo,
  WebhookRegisterParams,
  WebhookResult,
  CommitmentParams,
  StealthResult,
  Announcement,
  PaymentUrlParams,
  ParsedPaymentUrl,
  ZKProof,
  TxResult,
  ErrorCode,
} from './types';

// Errors
export { IPayError } from './types/errors';

// Keys
export { generateKeyPair, parseAddress } from './keys';

// Stealth
export { deriveStealthAddress, scanAnnouncement, scanAnnouncements } from './stealth';

// ZK
export { computeCommitment, computeNullifier, poseidonHash } from './zk';

// Chains
export { getChain, getAllChains, getMainnetChains, getTestnetChains, CHAINS } from './chains/registry';

// Utils
export { toBaseUnits, fromBaseUnits, formatAmount } from './utils/amounts';
export { buildPaymentUrl, parsePaymentUrl } from './utils/url';
export { generateClaimCode, isValidClaimCode, hashClaimCode } from './utils/check-code';
