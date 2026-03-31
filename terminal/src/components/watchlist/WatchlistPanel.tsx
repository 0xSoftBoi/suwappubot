import { useState, useRef, useEffect } from 'react'
import { useWatchlist, type WatchlistToken } from '../../hooks/useWatchlist'
import { useWatchlistPrices } from '../../hooks/useWatchlistPrices'
import { usePair } from '../../contexts/PairContext'
import { WatchlistItem } from './WatchlistItem'

export function WatchlistPanel() {
  const { watchlist, addToken, removeToken } = useWatchlist()
  const { getPrice, refetch } = useWatchlistPrices(watchlist)
  const { setSelectedPair, setSelectedChain } = usePair()
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showAdd) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [showAdd])

  const handleAddSubmit = () => {
    // Parse simple input: SYMBOL/CHAIN/ADDRESS/NAME
    const parts = search.split('/')
    if (parts.length >= 3) {
      const token: WatchlistToken = {
        symbol: parts[0].trim().toUpperCase(),
        chain: parts[1].trim().toLowerCase(),
        address: parts[2].trim(),
        name: parts[3]?.trim() || parts[0].trim(),
      }
      addToken(token)
      setSearch('')
      setShowAdd(false)
    }
  }

  const handleQuickAdd = () => {
    // Allow adding by just symbol for quick prototyping
    if (search.trim().length > 0) {
      const token: WatchlistToken = {
        symbol: search.trim().toUpperCase(),
        chain: 'ethereum',
        address: `0x${search.trim().toLowerCase()}`,
        name: search.trim(),
      }
      addToken(token)
      setSearch('')
      setShowAdd(false)
    }
  }

  const handleTokenClick = (token: WatchlistToken) => {
    // Navigate to token chart by setting it as the selected pair
    setSelectedChain(token.chain)
    setSelectedPair({
      base: {
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        chain: token.chain,
        decimals: 18,
      },
      quote: {
        symbol: 'USDC',
        name: 'USD Coin',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        chain: token.chain,
        decimals: 6,
      },
    })
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
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <span className="text-xs text-terminal-text-muted font-mono">
            {watchlist.length} tokens
          </span>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-terminal-text-muted hover:text-sakura-400 transition-colors p-0.5"
            title="Add token"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Add token form */}
      {showAdd && (
        <div className="px-3 py-2 border-b border-terminal-border bg-terminal-bg-secondary shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (search.includes('/')) handleAddSubmit()
                  else handleQuickAdd()
                }
                if (e.key === 'Escape') {
                  setShowAdd(false)
                  setSearch('')
                }
              }}
              placeholder="SYMBOL or SYMBOL/chain/0xaddr/Name"
              className="terminal-input flex-1 text-xs py-1.5"
            />
            <button
              onClick={() => {
                if (search.includes('/')) handleAddSubmit()
                else handleQuickAdd()
              }}
              disabled={!search.trim()}
              className="terminal-button text-xs px-3 py-1.5"
            >
              Add
            </button>
          </div>
          <p className="text-[10px] text-terminal-text-muted mt-1">
            Enter token symbol or SYMBOL/chain/address/name
          </p>
        </div>
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
              Click the + button to add tokens
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
