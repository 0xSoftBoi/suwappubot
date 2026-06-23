/**
 * Wraps children in the P2P.me SDK provider so the `usePrices` / `useProfile` /
 * `useOrders` hooks can read from (and write to) the on-chain Diamond.
 *
 * The publicClient is captured on mount by the SDK, so we remount via `key`
 * whenever the chain changes. Reads (prices/limits/balance) need only the
 * publicClient + diamond; the subgraphUrl is required by the config type but
 * only powers order-history reads.
 */

import { useMemo, type ReactNode } from 'react'
import { SdkProvider } from '@p2pdotme/sdk/react'
import {
  createP2PMePublicClient,
  getP2PMeConfig,
  getDefaultP2PMeNetwork,
  type P2PMeNetwork,
} from '../../config/p2pme'

interface P2PMeProviderProps {
  children: ReactNode
  network?: P2PMeNetwork
}

export function P2PMeProvider({ children, network }: P2PMeProviderProps) {
  const net = network ?? getDefaultP2PMeNetwork()
  const cfg = useMemo(() => getP2PMeConfig(net), [net])
  const publicClient = useMemo(() => createP2PMePublicClient(net), [net])

  return (
    <SdkProvider
      key={cfg.chainId}
      // viem PublicClient satisfies the SDK's structural PublicClientLike.
      publicClient={publicClient}
      subgraphUrl={cfg.subgraphUrl}
      diamondAddress={cfg.diamond}
      usdcAddress={cfg.usdc}
      p2pTokenAddress={cfg.p2pToken}
    >
      {children}
    </SdkProvider>
  )
}
