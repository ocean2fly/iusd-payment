import { toBaseUnits, fromBaseUnits } from '../../src/utils/amounts';

// TC-SDK-U8: Amount formatting
describe('toBaseUnits', () => {
  it('converts 50.00 to 50000000', () => {
    expect(toBaseUnits('50.00')).toBe('50000000');
  });

  it('converts 0.001 to 1000', () => {
    expect(toBaseUnits('0.001')).toBe('1000');
  });

  it('converts whole numbers', () => {
    expect(toBaseUnits('1')).toBe('1000000');
  });

  it('throws for amounts below minimum (0.001)', () => {
    expect(() => toBaseUnits('0.0001')).toThrow();
  });

  it('throws for negative amounts', () => {
    expect(() => toBaseUnits('-1')).toThrow();
  });

  it('throws for invalid strings', () => {
    expect(() => toBaseUnits('abc')).toThrow();
  });

  it('converts zero', () => {
    expect(toBaseUnits('0')).toBe('0');
  });
});

describe('fromBaseUnits', () => {
  it('converts 50000000 to 50.00', () => {
    expect(fromBaseUnits('50000000')).toBe('50.00');
  });

  it('converts 1000 to 0.001000', () => {
    expect(fromBaseUnits('1000')).toBe('0.001');
  });

  it('converts 0 to 0.00', () => {
    expect(fromBaseUnits('0')).toBe('0.00');
  });

  it('converts 1000000 to 1.00', () => {
    expect(fromBaseUnits('1000000')).toBe('1.00');
  });
});
