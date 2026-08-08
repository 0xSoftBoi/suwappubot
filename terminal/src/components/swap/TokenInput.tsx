import { useState, useRef, useEffect } from 'react'
import { useTokenSelectorTokens } from '../../hooks/useTokens'
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

// Keep only a well-formed positive decimal: digits + at most one dot. This stops
// negatives, scientific notation, letters and stray symbols from ever reaching the
// quote request (and the swap), where they'd become NaN or a malformed amount.
function sanitizeAmount(raw: string): string {
  let v = raw.replace(/[^\d.]/g, '')
  const firstDot = v.indexOf('.')
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '')
  }
  return v
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
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setSelectorOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  const { data: tokens, isFetching } = useTokenSelectorTokens(search, token?.chain, selectorOpen)

  return (
    <div className="bg-terminal-bg rounded-lg p-3">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-terminal-text-muted">{label}</span>
        {showBalance && token?.balance && (
          <button
            onClick={() => onAmountChange?.(token.balance!)}
            className="text-xs text-terminal-text-secondary hover:text-sakura-400 transition-colors"
          >
            Balance: <span className="tnum font-mono">{parseFloat(token.balance).toFixed(4)}</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={e => onAmountChange?.(sanitizeAmount(e.target.value))}
          placeholder="0.0"
          readOnly={readOnly}
          aria-label={`${label} amount`}
          className="terminal-amount-input tnum min-w-0 flex-1 bg-transparent text-xl font-mono text-terminal-text
                     placeholder-terminal-text-muted outline-none"
        />

        <div ref={ref} className="relative">
          <button
            onClick={() => { setSelectorOpen(!selectorOpen); setSearch('') }}
            aria-haspopup="listbox"
            aria-expanded={selectorOpen}
            aria-label={token ? `Change token, currently ${token.symbol}` : 'Select a token'}
            className="terminal-mobile-touch flex items-center gap-1.5 px-3 py-1.5 rounded-full
                       bg-terminal-bg-tertiary border border-terminal-border
                       hover:border-terminal-border-active transition-colors"
          >
            {token ? (
              <>
                {token.logoUrl ? (
                  <img src={token.logoUrl} alt="" className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-terminal-border flex items-center justify-center text-[10px] font-semibold">
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
            <div className="terminal-token-selector terminal-theme-overlay absolute right-0 top-full z-50 mt-1 w-64 rounded">
              <div className="p-2 border-b border-terminal-border">
                <input
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search tokens..."
                  aria-label="Search tokens"
                  className="terminal-input w-full text-sm"
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-y-auto" role="listbox" aria-label="Token results">
                {tokens?.length ? tokens.map(t => (
                  <button
                    key={`${t.chain}-${t.address}`}
                    role="option"
                    aria-selected={t.address === token?.address && t.chain === token?.chain}
                    onClick={() => { onTokenSelect(t); setSelectorOpen(false) }}
                    className="terminal-mobile-touch flex w-full items-center gap-2 px-3 py-2 text-sm
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
                )) : (
                  <div className="px-3 py-4 text-center text-terminal-text-muted text-sm">
                    {isFetching ? 'Loading tokens...' : 'No tokens found'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
