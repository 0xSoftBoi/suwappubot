import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { useWatchlist, type WatchlistToken } from '../../hooks/useWatchlist'
import { useWatchlistPrices } from '../../hooks/useWatchlistPrices'
import { usePair } from '../../contexts/PairContext'
import { pairFromToken } from '../../lib/quoteTokens'
import { api } from '../../lib/api'
import { WatchlistItem } from './WatchlistItem'

export function WatchlistPanel() {
  const { watchlist, addToken, removeToken } = useWatchlist()
  const { getPrice, refetch } = useWatchlistPrices(watchlist)
  const { setSelectedPair, selectedChain } = usePair()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  // Watchlist state lives in localStorage (see useWatchlist) — it persists per
  // device, which is what the panel offers today. The add control used to be
  // disabled behind a "backend persistence" note, leaving a visible tab whose
  // only action did nothing.
  const submitAdd = async (event: FormEvent) => {
    event.preventDefault()
    const q = query.trim()
    if (!q || busy) return
    setBusy(true)
    try {
      const results = await api.searchTokens(q, selectedChain)
      const exact = results.find((t) => t.symbol.toLowerCase() === q.toLowerCase())
        ?? results.find((t) => t.address.toLowerCase() === q.toLowerCase())
      const pick = exact ?? results[0]
      if (!pick) {
        toast.error(`No token matching "${q}" on ${selectedChain}`)
        return
      }
      addToken({ symbol: pick.symbol, name: pick.name, address: pick.address, chain: pick.chain || selectedChain })
      setQuery('')
      setAdding(false)
    } catch {
      toast.error('Token search failed — try again')
    } finally {
      setBusy(false)
    }
  }

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
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-terminal-text-muted transition-colors p-0.5 hover:text-terminal-text"
            title="Add token"
            aria-label="Add token to watchlist"
            aria-expanded={adding}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {adding && (
        <form
          onSubmit={submitAdd}
          className="flex items-center gap-2 px-3 py-2 border-b border-terminal-border bg-terminal-bg-secondary shrink-0"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`SYMBOL or address on ${selectedChain}`}
            aria-label="Token symbol or address"
            className="terminal-input min-w-0 flex-1 text-xs py-1 px-2"
          />
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="terminal-theme-control rounded-[6px] px-2.5 py-1 text-xs font-medium text-terminal-text disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}

      {/* Token list */}
      <div className="flex-1 overflow-y-auto">
        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <svg className="w-8 h-8 text-terminal-text-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
            <p className="text-sm text-terminal-text-muted mb-1">No tokens in watchlist</p>
            <p className="text-xs text-terminal-text-muted">
              Press + to add a token. Saved on this device.
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
