/**
 * App Providers — InterwovenKit + React Query + Wagmi
 *
 * Network is controlled by VITE_NETWORK / VITE_CHAIN_ID env vars.
 * All chain constants come from src/networkConfig.ts.
 *
 * Mobile wallet connections use MWP (Mobile Wallet Protocol) approach:
 * Direct deep links instead of relay servers.
 */
import { type PropsWithChildren } from 'react'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  initiaPrivyWalletConnector,
  injectStyles,
  InterwovenKitProvider,
  TESTNET,
} from '@initia/interwovenkit-react'
// @ts-ignore — Vite inline CSS import, same as official example
import InterwovenKitStyles from '@initia/interwovenkit-react/styles.css?inline'
import { NETWORK, CHAIN_ID } from './networkConfig'
import { ConfigProvider } from './hooks/useConfig'
import { useTheme } from './hooks/useTheme'

const wagmiConfig = createConfig({
  connectors: [initiaPrivyWalletConnector],
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
})

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

// Inject IK styles at module level (before first render) — matches official vite example
injectStyles(InterwovenKitStyles)

const isTestnet = NETWORK !== 'mainnet'

export function Providers({ children }: PropsWithChildren) {
  const ikTheme = useTheme()

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <InterwovenKitProvider
          {...(isTestnet ? TESTNET : {})}
          theme={ikTheme}
          disableAnalytics
          enableAutoSign={{
            [CHAIN_ID]: [
              '/cosmos.bank.v1beta1.MsgSend',
              '/initia.move.v1.MsgExecute',
            ],
          }}
        >
          <ConfigProvider>
            {children}
          </ConfigProvider>
        </InterwovenKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  )
}
