import { createContext, useContext, useCallback, useEffect, type ReactNode } from 'react'
import type { SwapToken } from '../types/api'
import { usePersistentState } from '../lib/persist'
import { nativeTokenFor, usdcFor } from '../lib/quoteTokens'

export interface SelectedPair {
  base: SwapToken | null
  quote: SwapToken | null
}

const MAX_RECENT = 8

interface PairContextType {
  selectedChain: string
  setSelectedChain: (chain: string) => void
  selectedPair: SelectedPair
  setSelectedPair: (pair: { base: SwapToken; quote: SwapToken }) => void
  // Recently-traded pairs (most-recent first) for quick re-access.
  recentPairs: SelectedPair[]
}

const DEFAULT_CHAIN = 'ethereum'

const DEFAULT_BASE: SwapToken = {
  symbol: 'ETH',
  name: 'Ethereum',
  address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  chain: 'ethereum',
  decimals: 18,
}

const DEFAULT_QUOTE: SwapToken = {
  symbol: 'USDC',
  name: 'USD Coin',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  chain: 'ethereum',
  decimals: 6,
}

const PairContext = createContext<PairContextType | undefined>(undefined)

function pairKey(p: SelectedPair): string {
  return `${p.base?.chain}:${p.base?.address}:${p.quote?.symbol}`.toLowerCase()
}

export function PairProvider({ children }: { children: ReactNode }) {
  // Persisted so the desk reopens on the pair/chain you left on (no amnesia).
  const [selectedChain, setSelectedChainState] = usePersistentState('chain', DEFAULT_CHAIN)
  const [selectedPair, setSelectedPairState] = usePersistentState<SelectedPair>('pair', {
    base: DEFAULT_BASE,
    quote: DEFAULT_QUOTE,
  })
  const [recentPairs, setRecentPairs] = usePersistentState<SelectedPair[]>('recentPairs', [])

  // A direct chain switch is also a market switch. Previously the header could
  // say "Solana" while SwapPanel still traded the persisted ETH/USDC pair,
  // which also sent users into the wrong wallet connector.
  const setSelectedChain = useCallback(
    (chain: string) => {
      setSelectedChainState(chain)
      setSelectedPairState({ base: nativeTokenFor(chain), quote: usdcFor(chain) })
    },
    [setSelectedChainState, setSelectedPairState],
  )

  const setSelectedPair = useCallback(
    (pair: { base: SwapToken; quote: SwapToken }) => {
      setSelectedPairState(pair)
      if (pair.base.chain) setSelectedChainState(pair.base.chain)
      // Record into recents (most-recent first, de-duped, capped).
      setRecentPairs((prev) => {
        const key = pairKey(pair)
        return [pair, ...prev.filter((p) => pairKey(p) !== key)].slice(0, MAX_RECENT)
      })
    },
    [setSelectedPairState, setSelectedChainState, setRecentPairs]
  )

  // Heal persisted state written by older builds where chain and pair could
  // drift apart. Normal pair changes always keep these equal after this pass.
  useEffect(() => {
    if (selectedPair.base?.chain && selectedPair.base.chain !== selectedChain) {
      setSelectedPairState({ base: nativeTokenFor(selectedChain), quote: usdcFor(selectedChain) })
    }
  }, [selectedChain, selectedPair.base?.chain, setSelectedPairState])

  return (
    <PairContext.Provider
      value={{ selectedChain, setSelectedChain, selectedPair, setSelectedPair, recentPairs }}
    >
      {children}
    </PairContext.Provider>
  )
}

export function usePair(): PairContextType {
  const context = useContext(PairContext)
  if (!context) throw new Error('usePair must be used within PairProvider')
  return context
}
