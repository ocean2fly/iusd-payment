import type { ErrorCode } from './index';

const ERROR_DEFAULTS: Record<string, { httpStatus: number; retryable: boolean }> = {
  E_NULLIFIER_SPENT:        { httpStatus: 409, retryable: false },
  E_INVALID_MERKLE_ROOT:    { httpStatus: 409, retryable: true },
  E_INSUFFICIENT_FUNDS:     { httpStatus: 402, retryable: false },
  E_ADDRESS_NOT_FOUND:      { httpStatus: 404, retryable: false },
  E_RETENTION_PERIOD_ACTIVE:{ httpStatus: 403, retryable: false },
  E_NOT_OWNER:              { httpStatus: 403, retryable: false },
  E_UNKNOWN_CHAIN:          { httpStatus: 400, retryable: false },
  E_INVALID_PROOF:          { httpStatus: 400, retryable: false },
  E_CHECK_EXPIRED:          { httpStatus: 410, retryable: false },
  E_CHECK_NOT_EXPIRED:      { httpStatus: 400, retryable: false },
  E_CHECK_CLAIMED:          { httpStatus: 409, retryable: false },
  E_SUBSCRIPTION_INACTIVE:  { httpStatus: 400, retryable: false },
  E_PERIOD_ALREADY_CLAIMED: { httpStatus: 409, retryable: false },
  E_INVALID_ADDRESS:        { httpStatus: 400, retryable: false },
  E_INVALID_AMOUNT:         { httpStatus: 400, retryable: false },
  E_MISSING_SPENDING_KEY:   { httpStatus: 400, retryable: false },
  E_NETWORK_ERROR:          { httpStatus: 500, retryable: true },
  E_UNKNOWN:                { httpStatus: 500, retryable: false },
};

export class IPayError extends Error {
  public readonly httpStatus: number;
  public readonly retryable: boolean;

  constructor(
    public readonly code: ErrorCode,
    message?: string,
    httpStatus?: number,
    retryable?: boolean,
    public readonly meta?: Record<string, unknown>,
  ) {
    const defaults = ERROR_DEFAULTS[code] || ERROR_DEFAULTS['E_UNKNOWN'];
    super(message || code);
    this.name = 'IPayError';
    this.httpStatus = httpStatus ?? defaults.httpStatus;
    this.retryable = retryable ?? defaults.retryable;
  }
}
