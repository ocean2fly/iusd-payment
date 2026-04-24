import { getChain, getAllChains } from '../../src/chains/registry';
import { IPayError } from '../../src/types/errors';

// TC-SDK-U14: Chains registry
describe('chains registry', () => {
  it('interwoven-1 is cosmos', () => {
    expect(getChain('interwoven-1').type).toBe('cosmos');
  });

  it('echelon-1 is move', () => {
    expect(getChain('echelon-1').type).toBe('move');
  });

  it('initiation-2 is testnet', () => {
    expect(getChain('initiation-2').network).toBe('testnet');
  });

  it('unknown chain throws E_UNKNOWN_CHAIN', () => {
    expect(() => getChain('ethereum')).toThrow(IPayError);
    try {
      getChain('ethereum');
    } catch (err) {
      expect((err as IPayError).code).toBe('E_UNKNOWN_CHAIN');
    }
  });

  it('inertia is cosmwasm', () => {
    expect(getChain('inertia').type).toBe('cosmwasm');
  });

  it('getAllChains returns all 7 chains', () => {
    expect(getAllChains()).toHaveLength(7);
  });

  it('interwoven-1 has no IBC channel (home chain)', () => {
    expect(getChain('interwoven-1').ibcChannel).toBeNull();
  });

  it('echelon-1 has IBC channel-1', () => {
    expect(getChain('echelon-1').ibcChannel).toBe('channel-1');
  });

  it('all mainnet chains have network=mainnet', () => {
    const mainnet = ['interwoven-1', 'echelon-1', 'inertia', 'moo-1', 'intergaze'];
    for (const id of mainnet) {
      expect(getChain(id).network).toBe('mainnet');
    }
  });
});
