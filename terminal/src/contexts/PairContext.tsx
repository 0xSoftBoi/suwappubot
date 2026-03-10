import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { SwapToken } from '../types/api'

export interface SelectedPair {
  base: SwapToken | null
  quote: SwapToken | null
}

interface PairContextType {
  selectedChain: string
  setSelectedChain: (chain: string) => void
  selectedPair: SelectedPair
  setSelectedPair: (pair: { base: SwapToken; quote: SwapToken }) => void
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

export function PairProvider({ children }: { children: ReactNode }) {
  const [selectedChain, setSelectedChain] = useState(DEFAULT_CHAIN)
  const [selectedPair, setSelectedPairState] = useState<SelectedPair>({
    base: DEFAULT_BASE,
    quote: DEFAULT_QUOTE,
  })

  const setSelectedPair = useCallback((pair: { base: SwapToken; quote: SwapToken }) => {
    setSelectedPairState(pair)
    if (pair.base.chain) setSelectedChain(pair.base.chain)
  }, [])

  return (
    <PairContext.Provider value={{ selectedChain, setSelectedChain, selectedPair, setSelectedPair }}>
      {children}
    </PairContext.Provider>
  )
}

export function usePair(): PairContextType {
  const context = useContext(PairContext)
  if (!context) throw new Error('usePair must be used within PairProvider')
  return context
}
