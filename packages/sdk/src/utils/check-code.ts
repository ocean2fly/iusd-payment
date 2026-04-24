import { randomBytes, bytesToHex } from '@noble/hashes/utils';
import { poseidonHash } from '../zk/poseidon';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0,O,1,I to avoid confusion
const GROUP_LEN = 4;
const GROUP_COUNT = 3;
const CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function generateClaimCode(): string {
  const bytes = randomBytes(GROUP_LEN * GROUP_COUNT);
  const groups: string[] = [];

  for (let g = 0; g < GROUP_COUNT; g++) {
    let group = '';
    for (let i = 0; i < GROUP_LEN; i++) {
      group += CHARS[bytes[g * GROUP_LEN + i] % CHARS.length];
    }
    groups.push(group);
  }

  return groups.join('-');
}

export function isValidClaimCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export async function hashClaimCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(code);
  let fieldValue = 0n;
  for (let i = 0; i < bytes.length; i++) {
    fieldValue = (fieldValue << 8n) | BigInt(bytes[i]);
  }
  return poseidonHash([fieldValue]);
}
