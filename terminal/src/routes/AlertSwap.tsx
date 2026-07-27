import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { pairFromToken } from '../lib/quoteTokens'
import { usePair } from '../contexts/PairContext'
import { useTrading } from '../contexts/TradingContext'
import { SwapPanel } from '../components/trade/SwapPanel'
import { TerminalSkeletonText } from '../components/foundation'
import type { SwapToken } from '../types/api'

// Landing page for the alert deep link:
//   /terminal/alert-swap?alertId=<id>&token=<SYMBOL>&chain=<chain>[&side=buy|sell][&amount=<amt>]&ref=alert
//
// This is a thin prefill wrapper around the EXISTING SwapPanel — it does not
// re-implement quoting, building, or signing. It only:
//   1. resolves the `token`+`chain` query params into a SwapToken (via the
//      existing token search endpoint),
//   2. writes that into PairContext/TradingContext exactly the way every other
//      "click a token to trade it" surface does (DiscoveryPanel, WatchlistPanel),
//   3. renders SwapPanel, which already gates on auth (shows WalletConnect when
//      unauthenticated) and already owns the sign flow via useExternalSwap.
//
// MONEY-PATH INVARIANT: this component MUST NEVER call buildSwap / executeSwap /
// executeExternalSwap on its own. It only ever pre-fills form state (selected
// pair, side, amount). The actual quote fetch + "Buy/Sell" tap inside SwapPanel
// remains the only path that leads to a signature — a URL can prefill a form,
// it can never sign a transaction. Do not add an auto-submit effect here.
export function AlertSwap() {
  const [searchParams] = useSearchParams()
  const { setSelectedPair } = usePair()
  const { setSide, setPendingSwapAmount } = useTrading()

  const alertId = searchParams.get('alertId')
  const tokenSymbol = searchParams.get('token')
  const chain = searchParams.get('chain')
  const side = searchParams.get('side')
  const amount = searchParams.get('amount')
  const ref = searchParams.get('ref')

  // Resolve the symbol into a real SwapToken (address + decimals) the same way
  // the token selector does. Only runs when both token + chain are present —
  // a notify-only link (token+chain only, no side/amount) still works, it just
  // skips the side/amount prefill below.
  const tokenQuery = useQuery({
    queryKey: ['alert-swap-token', tokenSymbol, chain],
    queryFn: () => api.searchTokens(tokenSymbol as string, chain as string),
    enabled: Boolean(tokenSymbol && chain),
    staleTime: 60_000,
  })

  const resolved: SwapToken | undefined = tokenQuery.data?.find(
    (t) => t.symbol.toLowerCase() === tokenSymbol?.toLowerCase()
  ) ?? tokenQuery.data?.[0]

  // Apply the prefill exactly once per landing (guarded by a ref) so the user
  // is still free to edit the pair/side/amount afterwards without us stomping
  // their edits on every re-render.
  const appliedRef = useRef(false)
  useEffect(() => {
    if (appliedRef.current) return
    if (!resolved) return

    setSelectedPair(pairFromToken(resolved))
    if (side === 'buy' || side === 'sell') setSide(side)
    if (amount) setPendingSwapAmount(amount)

    appliedRef.current = true
  }, [resolved, side, amount, setSelectedPair, setSide, setPendingSwapAmount])

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="rounded border border-terminal-border bg-terminal-bg-secondary px-3 py-2">
        <p className="text-sm font-semibold text-terminal-text">Alert swap</p>
        <p className="text-xs text-terminal-text-secondary">
          {tokenSymbol
            ? `Review and confirm your ${tokenSymbol}${chain ? ` (${chain})` : ''} trade. Nothing is submitted until you tap Buy/Sell below.`
            : 'Review and confirm your trade. Nothing is submitted until you tap Buy/Sell below.'}
        </p>
        {tokenSymbol && chain && tokenQuery.isFetching && (
          <TerminalSkeletonText lines={1} height={10} className="mt-1.5 max-w-[220px]" label="Resolving token" />
        )}
        {tokenSymbol && chain && !tokenQuery.isFetching && !resolved && (
          <p role="alert" className="mt-1 text-xs text-bear">
            Couldn't find {tokenSymbol} on {chain} — pick the token manually below.
          </p>
        )}
        {alertId && (
          <p className="mt-1 text-[10px] text-terminal-text-muted">
            From alert #{alertId}{ref ? ` · ${ref}` : ''}
          </p>
        )}
      </div>

      <SwapPanel />
    </div>
  )
}
