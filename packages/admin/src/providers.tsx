import { type PropsWithChildren } from 'react'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  initiaPrivyWalletConnector,
  injectStyles,
  InterwovenKitProvider,
  TESTNET,
  MAINNET,
} from '@initia/interwovenkit-react'
import { CHAIN_ID } from './lib/config'

const wagmiConfig = createConfig({
  connectors: [initiaPrivyWalletConnector],
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

const IK_CONFIG = CHAIN_ID === 'interwoven-1' ? MAINNET : TESTNET

// Inject IK styles eagerly — dynamic import prevents tree-shaking
import('@initia/interwovenkit-react/styles.js').then(m => injectStyles(m.default))

export function Providers({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <InterwovenKitProvider
          {...IK_CONFIG}
          theme="light"
          defaultChainId={CHAIN_ID}
        >
          {children}
        </InterwovenKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  )
}
