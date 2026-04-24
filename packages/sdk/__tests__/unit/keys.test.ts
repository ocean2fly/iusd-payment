import { generateKeyPair, parseAddress } from '../../src/keys';

// TC-SDK-U1: Key generation
describe('generateKeyPair', () => {
  it('generates keys with correct prefixes and lengths', async () => {
    const kp = await generateKeyPair();

    expect(kp.spendingKey).toMatch(/^sk1/);
    expect(kp.viewingKey).toMatch(/^vk1/);
    expect(kp.metaAddress.pkSpend).toHaveLength(64);
    expect(kp.metaAddress.pkView).toHaveLength(64);
    expect(kp.address).toMatch(/^init1/);
  });

  // TC-SDK-U2: Deterministic keys from seed
  it('generates deterministic keys from seed', async () => {
    const kp1 = await generateKeyPair({ seed: 'test-seed-01' });
    const kp2 = await generateKeyPair({ seed: 'test-seed-01' });

    expect(kp1.spendingKey).toBe(kp2.spendingKey);
    expect(kp1.viewingKey).toBe(kp2.viewingKey);
    expect(kp1.metaAddress.pkSpend).toBe(kp2.metaAddress.pkSpend);
    expect(kp1.metaAddress.pkView).toBe(kp2.metaAddress.pkView);
    expect(kp1.address).toBe(kp2.address);
  });

  it('generates different keys for different seeds', async () => {
    const kp1 = await generateKeyPair({ seed: 'seed-a' });
    const kp2 = await generateKeyPair({ seed: 'seed-b' });

    expect(kp1.spendingKey).not.toBe(kp2.spendingKey);
    expect(kp1.viewingKey).not.toBe(kp2.viewingKey);
  });

  it('generates different keys without seed (random)', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();

    expect(kp1.spendingKey).not.toBe(kp2.spendingKey);
  });
});

// TC-SDK-U9: Address resolution — format detection
describe('parseAddress', () => {
  it('detects bech32 addresses', () => {
    const result = parseAddress('init1x7qr8k4m2n5p6q7r8s9t0');
    expect(result.type).toBe('bech32');
  });

  it('detects hex addresses', () => {
    const result = parseAddress('0x1234abcdef');
    expect(result.type).toBe('hex');
  });

  it('detects username with .init suffix', () => {
    const result = parseAddress('alice.init');
    expect(result.type).toBe('username');
  });

  it('detects plain username', () => {
    const result = parseAddress('alice');
    expect(result.type).toBe('username');
  });
});
