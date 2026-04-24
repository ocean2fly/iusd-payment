import { generateKeyPair } from '../../src/keys';
import { deriveStealthAddress, scanAnnouncement } from '../../src/stealth';

// TC-SDK-U3: Stealth address derivation
describe('deriveStealthAddress', () => {
  it('produces valid bech32 stealth address and 64-char hex ephemeral pubkey', async () => {
    const kp = await generateKeyPair({ seed: 'stealth-test' });
    const result = deriveStealthAddress(kp.metaAddress);

    expect(result.stealthAddr).toMatch(/^init1/);
    expect(result.ephemeralPubkey).toHaveLength(64);
  });

  it('produces different stealth addresses on each call (ephemeral randomness)', async () => {
    const kp = await generateKeyPair({ seed: 'stealth-test-2' });
    const r1 = deriveStealthAddress(kp.metaAddress);
    const r2 = deriveStealthAddress(kp.metaAddress);

    expect(r1.stealthAddr).not.toBe(r2.stealthAddr);
    expect(r1.ephemeralPubkey).not.toBe(r2.ephemeralPubkey);
  });
});

// TC-SDK-U4: Stealth address scan — recipient discovers payment
describe('scanAnnouncement', () => {
  it('returns true for matching recipient', async () => {
    const recipient = await generateKeyPair({ seed: 'scan-recipient' });
    const { stealthAddr, ephemeralPubkey } = deriveStealthAddress(recipient.metaAddress);

    const found = scanAnnouncement(
      recipient.viewingKey,
      recipient.spendingKey,
      { stealthAddr, ephemeralPubkey },
    );

    expect(found).toBe(true);
  });

  // TC-SDK-U5: Stealth address scan — non-recipient
  it('returns false for non-matching recipient', async () => {
    const recipient = await generateKeyPair({ seed: 'scan-recipient-2' });
    const other = await generateKeyPair({ seed: 'scan-other' });

    const { stealthAddr, ephemeralPubkey } = deriveStealthAddress(other.metaAddress);

    const found = scanAnnouncement(
      recipient.viewingKey,
      recipient.spendingKey,
      { stealthAddr, ephemeralPubkey },
    );

    expect(found).toBe(false);
  });
});
