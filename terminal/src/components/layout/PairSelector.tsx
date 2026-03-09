import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { SwapToken } from '../../types/api'

interface Props {
  chain: string
  selected: { base: SwapToken | null; quote: SwapToken | null }
  onSelect: (pair: { base: SwapToken; quote: SwapToken }) => void
}

export function PairSelector({ chain, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Keyboard shortcut: Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
        setTimeout(() => inputRef.current?.focus(), 50)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const { data: tokens } = useQuery({
    queryKey: ['token-search', search, chain],
    queryFn: () => search.length >= 1 ? api.searchTokens(search, chain) : api.getPopularTokens(chain),
    staleTime: 30_000,
  })

  const handleSelectToken = (token: SwapToken) => {
    // If no base selected, or user is selecting a different base
    if (!selected.base || selected.quote) {
      // Start new pair
      onSelect({ base: token, quote: selected.quote || token })
    } else {
      // Selecting quote token
      onSelect({ base: selected.base, quote: token })
    }
    setOpen(false)
    setSearch('')
  }

  const label = selected.base && selected.quote
    ? `${selected.base.symbol}/${selected.quote.symbol}`
    : 'Select Pair'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 50) }}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-sm font-medium font-mono
                   hover:bg-terminal-bg-tertiary transition-colors"
      >
        <span className="text-terminal-text">{label}</span>
        <kbd className="hidden sm:inline text-[10px] text-terminal-text-muted bg-terminal-bg px-1 rounded">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-terminal-bg-secondary border border-terminal-border rounded shadow-lg z-50">
          <div className="p-2 border-b border-terminal-border">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tokens..."
              className="terminal-input w-full text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {tokens?.map(token => (
              <button
                key={`${token.chain}-${token.address}`}
                onClick={() => handleSelectToken(token)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-terminal-bg-tertiary transition-colors"
              >
                {token.logoUrl ? (
                  <img src={token.logoUrl} alt="" className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-terminal-border flex items-center justify-center text-[10px]">
                    {token.symbol[0]}
                  </div>
                )}
                <div className="flex-1 text-left">
                  <span className="text-terminal-text font-medium">{token.symbol}</span>
                  <span className="text-terminal-text-muted ml-2 text-xs">{token.name}</span>
                </div>
                {token.balance && (
                  <span className="text-terminal-text-secondary text-xs font-mono">
                    {parseFloat(token.balance).toFixed(4)}
                  </span>
                )}
              </button>
            )) || (
              <div className="px-3 py-4 text-center text-terminal-text-muted text-sm">
                Loading tokens...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
