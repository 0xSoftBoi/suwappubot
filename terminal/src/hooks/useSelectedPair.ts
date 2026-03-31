import { useState, useCallback } from 'react'
import type { SwapToken } from '../types/api'

interface SelectedPair {
  base: SwapToken | null
  quote: SwapToken | null
}

const DEFAULT_CHAIN = 'ethereum'

// Default ETH/USDC pair
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

export function useSelectedPair() {
  const [selectedChain, setSelectedChain] = useState(DEFAULT_CHAIN)
  const [selectedPair, setSelectedPair] = useState<SelectedPair>({
    base: DEFAULT_BASE,
    quote: DEFAULT_QUOTE,
  })

  const handleSetPair = useCallback((pair: { base: SwapToken; quote: SwapToken }) => {
    setSelectedPair(pair)
    if (pair.base.chain) setSelectedChain(pair.base.chain)
  }, [])

  return {
    selectedChain,
    setSelectedChain,
    selectedPair,
    setSelectedPair: handleSetPair,
  }
}
