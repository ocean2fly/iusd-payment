import { generateClaimCode, isValidClaimCode } from '../../src/utils/check-code';

// TC-SDK-U12: Check claim_code format validation
describe('isValidClaimCode', () => {
  it('accepts valid code format', () => {
    expect(isValidClaimCode('A7F2-K9M3-X4B1')).toBe(true);
  });

  it('rejects invalid format', () => {
    expect(isValidClaimCode('invalid')).toBe(false);
  });

  it('rejects too short (only 2 groups)', () => {
    expect(isValidClaimCode('A7F2-K9M3')).toBe(false);
  });

  it('rejects lowercase', () => {
    expect(isValidClaimCode('a7f2-k9m3-x4b1')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(isValidClaimCode('A7F2 K9M3 X4B1')).toBe(false);
  });
});

describe('generateClaimCode', () => {
  it('generates valid claim codes', () => {
    const code = generateClaimCode();
    expect(isValidClaimCode(code)).toBe(true);
  });

  it('generates unique codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateClaimCode());
    }
    expect(codes.size).toBe(100);
  });

  it('matches XXXX-XXXX-XXXX pattern', () => {
    const code = generateClaimCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });
});
