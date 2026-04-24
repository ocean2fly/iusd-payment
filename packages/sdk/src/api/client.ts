import { IPayError } from '../types/errors';
import type { ErrorCode } from '../types';

export interface ApiClientConfig {
  baseUrl: string;
  viewingKey: string;
  spendingKey?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      'X-Viewing-Key': config.viewingKey,
    };
    if (config.spendingKey) {
      this.headers['X-Spending-Key'] = config.spendingKey;
    }
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }
    return this.request<T>(url, { method: 'GET' });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    return this.request<T>(url, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    return this.request<T>(url, { method: 'DELETE' });
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const headers = { ...this.headers };

    try {
      const response = await fetch(url, { ...init, headers });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const code = (body as any)?.code || 'E_NETWORK_ERROR';
        const message = (body as any)?.message || response.statusText;
        throw new IPayError(
          code as ErrorCode,
          message,
          response.status,
          response.status >= 500,
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof IPayError) throw err;
      throw new IPayError(
        'E_NETWORK_ERROR',
        (err as Error).message,
        500,
        true,
      );
    }
  }
}
