import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../lib/api'
import type { SwapQuote, SwapToken } from '../types/swap'
import type { SimulationResult, RouteStep, SimulationWarning } from '../types/simulation'

// Re-export types so consumers can import from the hook module
export type {
  SimulationResult,
  SimulationBalanceChange,
  SimulationGasEstimate,
  RouteStep,
  SimulationWarning,
} from '../types/simulation'

// ── Route parsing ──────────────────────────────────────

/**
 * Parse the route string from a SwapQuote into structured RouteStep[].
 * Handles formats like:
 *   "ETH -> Uniswap V3 -> USDC"
 *   "ETH -> Uniswap V3 -> WBTC -> SushiSwap -> USDC"
 *   "ETH > USDC via Uniswap"
 *   "Direct swap via 1inch"
 */
function parseRouteString(route: string, fromSymbol: string, toSymbol: string): RouteStep[] {
  if (!route) {
    return [{ from: fromSymbol, to: toSymbol, dex: 'Best Route' }]
  }

  // Try "A -> DEX -> B -> DEX -> C" pattern (arrow-separated with alternating tokens/dexes)
  const arrowParts = route.split(/\s*(?:->|→|>)\s*/).map(s => s.trim()).filter(Boolean)
  if (arrowParts.length >= 3) {
    const steps: RouteStep[] = []
    // Pattern: token, dex, token, dex, token...
    for (let i = 0; i < arrowParts.length - 2; i += 2) {
      steps.push({
        from: arrowParts[i],
        to: arrowParts[i + 2],
        dex: arrowParts[i + 1],
      })
    }
    if (steps.length > 0) return steps
  }

  // Try "via DEX" pattern
  const viaMatch = route.match(/via\s+(.+)/i)
  if (viaMatch) {
    return [{ from: fromSymbol, to: toSymbol, dex: viaMatch[1].trim() }]
  }

  // Fallback: use the whole string as the dex name
  return [{ from: fromSymbol, to: toSymbol, dex: route }]
}

// ── Warning generation ─────────────────────────────────

function generateWarnings(quote: SwapQuote, fromToken?: SwapToken | null, toToken?: SwapToken | null): SimulationWarning[] {
  const warnings: SimulationWarning[] = []

  // High price impact
  if (quote.priceImpact > 5) {
    warnings.push({
      severity: 'high',
      message: `Very high price impact (${quote.priceImpact.toFixed(2)}%). You may receive significantly less than expected.`,
    })
  } else if (quote.priceImpact > 3) {
    warnings.push({
      severity: 'medium',
      message: `High price impact (${quote.priceImpact.toFixed(2)}%). Consider reducing your swap size.`,
    })
  }

  // High slippage setting
  if (quote.slippage > 2) {
    warnings.push({
      severity: 'medium',
      message: `Slippage tolerance is set to ${quote.slippage}%. This is higher than recommended.`,
    })
  }

  // Large trade (USD value > $10k)
  if (quote.fromAmountUsd > 10000) {
    warnings.push({
      severity: 'medium',
      message: 'Large trade detected. Consider splitting into smaller transactions for better execution.',
    })
  }

  // New/unverified token (no logo is a rough heuristic)
  if (toToken && !toToken.logoUrl) {
    warnings.push({
      severity: 'low',
      message: `${toToken.symbol} may be an unverified token. Verify the contract address before proceeding.`,
    })
  }
  if (fromToken && !fromToken.logoUrl) {
    warnings.push({
      severity: 'low',
      message: `${fromToken.symbol} may be an unverified token. Verify the contract address before proceeding.`,
    })
  }

  // High gas relative to trade value
  if (quote.fromAmountUsd > 0 && quote.gasUsd / quote.fromAmountUsd > 0.05) {
    warnings.push({
      severity: 'low',
      message: `Gas fee is ${((quote.gasUsd / quote.fromAmountUsd) * 100).toFixed(1)}% of your trade value.`,
    })
  }

  return warnings
}

// ── Chain name mapping ─────────────────────────────────

function getChainName(chainId: string): string {
  const chains: Record<string, string> = {
    '1': 'Ethereum',
    '10': 'Optimism',
    '56': 'BNB Chain',
    '100': 'Gnosis',
    '137': 'Polygon',
    '250': 'Fantom',
    '324': 'zkSync Era',
    '8453': 'Base',
    '42161': 'Arbitrum',
    '43114': 'Avalanche',
    '59144': 'Linea',
  }
  return chains[chainId] || `Chain ${chainId}`
}

// ── Fallback: build SimulationResult from quote ────────

function buildSimulationFromQuote(
  quote: SwapQuote,
  fromToken?: SwapToken | null,
  toToken?: SwapToken | null,
): SimulationResult {
  const fromSymbol = fromToken?.symbol || quote.fromToken?.symbol || '???'
  const toSymbol = toToken?.symbol || quote.toToken?.symbol || '???'
  const chainId = fromToken?.chain || quote.fromToken?.chain || '1'

  return {
    balanceChanges: [
      {
        token: fromToken?.address || '',
        symbol: fromSymbol,
        amount: quote.fromAmount,
        amountUsd: quote.fromAmountUsd,
        direction: 'out',
      },
      {
        token: toToken?.address || '',
        symbol: toSymbol,
        amount: quote.toAmount,
        amountUsd: quote.toAmountUsd,
        direction: 'in',
      },
    ],
    gasEstimate: {
      amount: quote.estimatedGas || '0',
      amountUsd: quote.gasUsd,
      network: getChainName(chainId),
    },
    priceImpact: quote.priceImpact,
    route: parseRouteString(quote.route, fromSymbol, toSymbol),
    warnings: generateWarnings(quote, fromToken, toToken),
  }
}

// ── Hook ───────────────────────────────────────────────

export function useTransactionSimulation(
  quote: SwapQuote | null | undefined,
  fromToken?: SwapToken | null,
  toToken?: SwapToken | null,
) {
  // Derive fallback simulation from quote data (always available when quote exists)
  const fallbackSimulation = useMemo(() => {
    if (!quote) return null
    return buildSimulationFromQuote(quote, fromToken, toToken)
  }, [quote, fromToken, toToken])

  // Try to fetch server-side simulation (may 404 if not implemented yet)
  const {
    data: serverSimulation,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['swap-simulation', quote?.id],
    queryFn: () => api.simulateSwap(quote!.id),
    enabled: !!quote?.id,
    staleTime: 30 * 1000,
    gcTime: 60 * 1000,
    retry: false, // Don't retry — fallback handles failure
  })

  // Use server simulation if available, otherwise fallback
  const simulation = serverSimulation ?? fallbackSimulation

  return {
    simulation,
    isLoading: !!quote && isLoading && !fallbackSimulation,
    error,
    isServerSimulation: !!serverSimulation,
  }
}
