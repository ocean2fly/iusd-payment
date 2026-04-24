/**
 * Shared API Contract Types
 *
 * Single source of truth for all API request/response shapes.
 * Both packages/api and packages/app import from here.
 *
 * Naming convention: camelCase everywhere (DB columns use snake_case internally,
 * but API always returns camelCase — enforced here).
 */

// ─── Auth ──────────────────────────────────────────────────────────────────

export interface ApiNonceResponse {
  nonce: string
}

export interface ApiVerifyRequest {
  address: string
  nonce: string
  signature: string
  pubkey?: string
}

export interface ApiVerifyResponse {
  sessionToken: string
  expiresAt: string
}

// ─── Account ───────────────────────────────────────────────────────────────

export interface ApiAccount {
  shortId: string
  checksum: string
  nickname: string
  address: string
  display: string          // formatted: "nickname#XXXX[YYY]"
  avatarSeed:  string | null
  avatarSvg:   string | null
  shortSealSvg: string | null
  defaultClaimAddress: string | null
  autoClaimEnabled:    boolean
  merchantName:        string | null
  merchantData:        Record<string, any> | null
  bio:                 string
  createdAt: string
}

export interface ApiAccountResponse {
  account: ApiAccount
}

export interface ApiRegisterRequest {
  nickname: string
}

// ─── Payments ──────────────────────────────────────────────────────────────

export type PaymentStatus = 'PENDING_CLAIM' | 'CONFIRMED' | 'REFUNDED'

export interface ApiPayment {
  orderId: string
  amount: string           // decimal string, e.g. "10.5"
  status: PaymentStatus
  senderAddress: string
  poolAddress: string
  createdAt: string
  claimedAt: string | null
}

// ─── Generic ───────────────────────────────────────────────────────────────

export interface ApiError {
  error: string
  message?: string
}

export interface ApiSuccess {
  success: true
}
