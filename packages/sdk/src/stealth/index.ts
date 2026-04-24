import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { bech32 } from 'bech32';
import type { MetaAddress, StealthResult, Announcement } from '../types';

function computeShared(ephemeralPubkeyHex: string, pkViewOrVkBytes: Uint8Array): Uint8Array {
  const ephBytes = hexToBytes(ephemeralPubkeyHex);
  const input = new Uint8Array(ephBytes.length + pkViewOrVkBytes.length);
  input.set(ephBytes);
  input.set(pkViewOrVkBytes, ephBytes.length);
  return sha256(input);
}

function computeStealthAddr(pkSpendHex: string, shared: Uint8Array): string {
  const pkSpendBytes = hexToBytes(pkSpendHex);
  const stealthInput = new Uint8Array(pkSpendBytes.length + shared.length);
  stealthInput.set(pkSpendBytes);
  stealthInput.set(shared, pkSpendBytes.length);
  const stealthHash = sha256(stealthInput);
  const addrBytes = stealthHash.slice(0, 20);
  const words = bech32.toWords(addrBytes);
  return bech32.encode('init', words);
}

export function deriveStealthAddress(recipientMetaAddr: MetaAddress): StealthResult {
  const ephemeralRandom = randomBytes(32);
  const ephemeralPubkey = bytesToHex(sha256(ephemeralRandom));

  // Shared secret: hash(ephemeralPubkey || pkView)
  // The recipient can compute this with hash(ephemeralPubkey || pkView)
  // since pkView = sha256(vkBytes), we use pkView directly
  const pkViewBytes = hexToBytes(recipientMetaAddr.pkView);
  const shared = computeShared(ephemeralPubkey, pkViewBytes);

  const stealthAddr = computeStealthAddr(recipientMetaAddr.pkSpend, shared);

  return { stealthAddr, ephemeralPubkey };
}

export function scanAnnouncement(
  viewingKey: string,
  spendingKey: string,
  announcement: Announcement,
): boolean {
  // Reconstruct pkView from viewing key (same as key generation)
  const vkBytes = hexToBytes(viewingKey.replace(/^vk1/, ''));
  const pkView = sha256(vkBytes);

  // Reconstruct pkSpend from spending key
  const skBytes = hexToBytes(spendingKey.replace(/^sk1/, ''));
  const pkSpend = bytesToHex(sha256(skBytes));

  // Compute shared secret the same way: hash(ephemeralPubkey || pkView)
  const shared = computeShared(announcement.ephemeralPubkey, pkView);

  const candidateAddr = computeStealthAddr(pkSpend, shared);

  return candidateAddr === announcement.stealthAddr;
}

export function scanAnnouncements(
  viewingKey: string,
  spendingKey: string,
  announcements: Announcement[],
): Announcement[] {
  return announcements.filter((a) => scanAnnouncement(viewingKey, spendingKey, a));
}
