import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { SwapToken } from '../../types/api'

interface Props {
  label: string
  token: SwapToken | null
  amount: string
  onAmountChange?: (amount: string) => void
  onTokenSelect: (token: SwapToken) => void
  readOnly?: boolean
  showBalance?: boolean
}

export function TokenInput({
  label,
  token,
  amount,
  onAmountChange,
  onTokenSelect,
  readOnly,
  showBalance,
}: Props) {
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setSelectorOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const { data: tokens } = useQuery({
    queryKey: ['token-search-swap', search, token?.chain],
    queryFn: () => search.length >= 1
      ? api.searchTokens(search, token?.chain)
      : api.getPopularTokens(token?.chain),
    enabled: selectorOpen,
    staleTime: 30_000,
  })

  return (
    <div className="bg-terminal-bg rounded-lg p-3">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-terminal-text-muted">{label}</span>
        {showBalance && token?.balance && (
          <button
            onClick={() => onAmountChange?.(token.balance!)}
            className="text-xs text-terminal-text-secondary hover:text-sakura-400 transition-colors"
          >
            Balance: <span className="font-mono">{parseFloat(token.balance).toFixed(4)}</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={amount}
          onChange={e => onAmountChange?.(e.target.value)}
          placeholder="0.0"
          readOnly={readOnly}
          className="flex-1 bg-transparent text-xl font-mono text-terminal-text
                     placeholder-terminal-text-muted outline-none"
        />

        <div ref={ref} className="relative">
          <button
            onClick={() => { setSelectorOpen(!selectorOpen); setSearch('') }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                       bg-terminal-bg-tertiary border border-terminal-border
                       hover:border-terminal-border-active transition-colors"
          >
            {token ? (
              <>
                {token.logoUrl ? (
                  <img src={token.logoUrl} alt="" className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-terminal-border flex items-center justify-center text-[10px] font-bold">
                    {token.symbol[0]}
                  </div>
                )}
                <span className="font-medium text-sm">{token.symbol}</span>
              </>
            ) : (
              <span className="text-sm text-terminal-text-secondary">Select</span>
            )}
            <svg className="w-3 h-3 text-terminal-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {selectorOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-terminal-bg-secondary border border-terminal-border rounded shadow-lg z-50">
              <div className="p-2 border-b border-terminal-border">
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search tokens..."
                  className="terminal-input w-full text-sm"
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {tokens?.map(t => (
                  <button
                    key={`${t.chain}-${t.address}`}
                    onClick={() => { onTokenSelect(t); setSelectorOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm
                               hover:bg-terminal-bg-tertiary transition-colors"
                  >
                    {t.logoUrl ? (
                      <img src={t.logoUrl} alt="" className="w-5 h-5 rounded-full" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-terminal-border flex items-center justify-center text-[10px]">
                        {t.symbol[0]}
                      </div>
                    )}
                    <span className="font-medium">{t.symbol}</span>
                    <span className="text-terminal-text-muted text-xs flex-1 text-left">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
