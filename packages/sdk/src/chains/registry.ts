import type { Chain, ChainConfig } from '../types';
import { IPayError } from '../types/errors';

const CHAINS: Record<Chain, ChainConfig> = {
  'interwoven-1': {
    id: 'interwoven-1',
    name: 'Initia',
    type: 'cosmos',
    network: 'mainnet',
    rpc: 'https://rpc.initia.xyz',
    ibcChannel: null,
  },
  'echelon-1': {
    id: 'echelon-1',
    name: 'Echelon',
    type: 'move',
    network: 'mainnet',
    ibcChannel: 'channel-1',
  },
  inertia: {
    id: 'inertia',
    name: 'Inertia',
    type: 'cosmwasm',
    network: 'mainnet',
    ibcChannel: 'channel-2',
  },
  'moo-1': {
    id: 'moo-1',
    name: 'Moo',
    type: 'cosmos',
    network: 'mainnet',
    ibcChannel: 'channel-3',
  },
  intergaze: {
    id: 'intergaze',
    name: 'Intergaze',
    type: 'cosmos',
    network: 'mainnet',
    ibcChannel: 'channel-4',
  },
  'initiation-2': {
    id: 'initiation-2',
    name: 'Initia Testnet',
    type: 'cosmos',
    network: 'testnet',
    rpc: 'https://rpc.testnet.initia.xyz',
  },
  'minimove-1': {
    id: 'minimove-1',
    name: 'MiniMove',
    type: 'move',
    network: 'testnet',
  },
};

export function getChain(chainId: string): ChainConfig {
  const chain = CHAINS[chainId as Chain];
  if (!chain) {
    throw new IPayError('E_UNKNOWN_CHAIN', `Unknown chain: ${chainId}`);
  }
  return chain;
}

export function getAllChains(): ChainConfig[] {
  return Object.values(CHAINS);
}

export function getMainnetChains(): ChainConfig[] {
  return getAllChains().filter((c) => c.network === 'mainnet');
}

export function getTestnetChains(): ChainConfig[] {
  return getAllChains().filter((c) => c.network === 'testnet');
}

export { CHAINS };
