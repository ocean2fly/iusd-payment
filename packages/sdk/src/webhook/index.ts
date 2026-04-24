import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { ApiClient } from '../api/client';
import type { WebhookRegisterParams, WebhookResult } from '../types';

export class WebhookModule {
  constructor(private readonly api: ApiClient) {}

  async register(params: WebhookRegisterParams): Promise<WebhookResult> {
    return this.api.post<WebhookResult>('/webhooks', params);
  }

  verify(payload: string, signature: string, secret: string): boolean {
    const expected = bytesToHex(
      sha256(new TextEncoder().encode(payload + secret)),
    );
    return expected === signature;
  }
}
