import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { bech32 } from 'bech32';
import type { KeyPair, KeyPairOptions, AddressInfo } from '../types';

export async function generateKeyPair(options?: KeyPairOptions): Promise<KeyPair> {
  let spendBytes: Uint8Array;
  let viewBytes: Uint8Array;

  if (options?.seed) {
    const seedHash = sha256(new TextEncoder().encode(options.seed));
    spendBytes = seedHash.slice(0, 32);
    const viewSeedHash = sha256(new TextEncoder().encode(options.seed + ':view'));
    viewBytes = viewSeedHash.slice(0, 32);
  } else {
    const { randomBytes } = await import('@noble/hashes/utils');
    spendBytes = randomBytes(32);
    viewBytes = randomBytes(32);
  }

  const pkSpendHash = sha256(spendBytes);
  const pkViewHash = sha256(viewBytes);

  const pkSpend = bytesToHex(pkSpendHash);
  const pkView = bytesToHex(pkViewHash);

  const spendingKey = 'sk1' + bytesToHex(spendBytes);
  const viewingKey = 'vk1' + bytesToHex(viewBytes);

  const addrBytes = pkSpendHash.slice(0, 20);
  const words = bech32.toWords(addrBytes);
  const address = bech32.encode('init', words);

  return {
    spendingKey,
    viewingKey,
    metaAddress: { pkSpend, pkView },
    address,
  };
}

export function parseAddress(input: string): AddressInfo {
  if (input.startsWith('init1')) {
    return { type: 'bech32', value: input };
  }
  if (input.startsWith('0x') || input.startsWith('0X')) {
    return { type: 'hex', value: input };
  }
  return { type: 'username', value: input };
}
