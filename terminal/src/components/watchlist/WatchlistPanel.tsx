import { useWatchlist, type WatchlistToken } from '../../hooks/useWatchlist'
import { useWatchlistPrices } from '../../hooks/useWatchlistPrices'
import { usePair } from '../../contexts/PairContext'
import { pairFromToken } from '../../lib/quoteTokens'
import { WatchlistItem } from './WatchlistItem'

export function WatchlistPanel() {
  const { watchlist, removeToken } = useWatchlist()
  const { getPrice, refetch } = useWatchlistPrices(watchlist)
  const { setSelectedPair } = usePair()

  const handleTokenClick = (token: WatchlistToken) => {
    // Navigate to token chart by setting it as the selected pair. Quotes against
    // the chain's canonical USDC (setSelectedPair also syncs the active chain).
    setSelectedPair(pairFromToken({
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      chain: token.chain,
      decimals: 18,
    }))
  }

  return (
    <div className="h-full flex flex-col" data-testid="watchlist-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border shrink-0">
        <h3 className="text-sm font-semibold text-terminal-text">Watchlist</h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={refetch}
            className="text-terminal-text-muted hover:text-terminal-text transition-colors p-0.5"
            title="Refresh prices"
            aria-label="Refresh watchlist prices"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <span className="text-xs text-terminal-text-muted font-mono">
            {watchlist.length} tokens
          </span>
          <button
            disabled
            className="text-terminal-text-muted transition-colors p-0.5 opacity-50"
            title="Watchlist provider pending"
            aria-label="Add token to watchlist (coming soon)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-terminal-border bg-terminal-bg-secondary shrink-0 text-xs text-terminal-text-muted">
        Watchlist backend persistence is not connected yet.
      </div>

      {/* Token list */}
      <div className="flex-1 overflow-y-auto">
        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <svg className="w-8 h-8 text-terminal-text-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
            <p className="text-sm text-terminal-text-muted mb-1">No tokens in watchlist</p>
            <p className="text-xs text-terminal-text-muted">
              Watchlist controls are disabled until backend persistence is connected.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-terminal-border">
            {watchlist.map(token => (
              <WatchlistItem
                key={`${token.chain}-${token.address}`}
                token={token}
                priceData={getPrice(token.chain, token.address)}
                onRemove={removeToken}
                onClick={handleTokenClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
