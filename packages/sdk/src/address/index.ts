import type { ApiClient } from '../api/client';
import type { ResolvedAddress, AddressInfo } from '../types';
import { parseAddress } from '../keys';

export class AddressModule {
  constructor(private readonly api: ApiClient) {}

  async resolve(input: string): Promise<ResolvedAddress> {
    return this.api.get<ResolvedAddress>('/address/resolve', { address: input });
  }

  validate(input: string): AddressInfo {
    return parseAddress(input);
  }

  format(input: string): AddressInfo {
    return parseAddress(input);
  }
}
