import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { usePair } from '../../contexts/PairContext'
import { useTrading, type TradingMode } from '../../contexts/TradingContext'
import { useBottomTab, type BottomTab } from '../../contexts/BottomTabContext'
import { usePopularTokens, useSearchTokens } from '../../hooks/useTokens'
import type { SwapToken } from '../../types/api'

// Custom event other components dispatch to open the palette (no extra context).
export const OPEN_EVENT = 'suwappu:open-command-palette'
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

// Chains a trader can discover tokens on. Labels kept short for the chip row.
const CHAINS: { id: string; label: string }[] = [
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'base', label: 'Base' },
  { id: 'arbitrum', label: 'Arbitrum' },
  { id: 'solana', label: 'Solana' },
  { id: 'bsc', label: 'BSC' },
  { id: 'polygon', label: 'Polygon' },
]

interface NavCommand {
  id: string
  label: string
  hint: string
  icon: string
  run: () => void
  keywords: string
}

type Row =
  | { kind: 'nav'; cmd: NavCommand }
  | { kind: 'token'; token: SwapToken }

function TokenLogo({ token }: { token: SwapToken }) {
  return token.logoUrl ? (
    <img src={token.logoUrl} alt="" className="h-6 w-6 rounded-full" />
  ) : (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-terminal-border text-[11px] font-semibold text-terminal-text-secondary">
      {token.symbol[0]}
    </div>
  )
}

// The terminal's command palette — one place to switch what you're trading and
// jump anywhere. Opens on ⌘K / Ctrl+K or via openCommandPalette(). Shows popular
// tokens + navigation by default (discoverability), searches tokens as you type,
// and selecting a token sets it as the pair in one click (no base/quote dance).
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [chain, setChain] = useState('ethereum')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const { selectedChain, setSelectedChain, selectedPair, setSelectedPair } = usePair()
  const { setTradingMode } = useTrading()
  const { setActiveTab } = useBottomTab()

  // Open via ⌘K / Ctrl+K (anywhere) or the custom event from the header button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  // On open: sync chip to the active chain, reset query, focus the input.
  useEffect(() => {
    if (open) {
      setChain(selectedChain || 'ethereum')
      setQuery('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open, selectedChain])

  const goSpotTab = useCallback(
    (tab: BottomTab) => {
      setTradingMode('spot')
      setActiveTab(tab)
    },
    [setTradingMode, setActiveTab]
  )

  const navCommands: NavCommand[] = useMemo(() => {
    const mode = (m: TradingMode, label: string, hint: string, icon: string): NavCommand => ({
      id: `mode-${m}`,
      label,
      hint,
      icon,
      keywords: `${label} ${hint} ${m}`,
      run: () => setTradingMode(m),
    })
    const tab = (t: BottomTab, label: string, hint: string, icon: string): NavCommand => ({
      id: `tab-${t}`,
      label,
      hint,
      icon,
      keywords: `${label} ${hint} ${t}`,
      run: () => goSpotTab(t),
    })
    return [
      mode('spot', 'Spot', 'Cross-chain swaps', '💱'),
      mode('perps', 'Perps', 'HyperLiquid perpetuals', '📈'),
      mode('predict', 'Predict', 'Polymarket prediction markets', '🎲'),
      tab('signals', 'Signals', 'Cross-market what-matters feed', '📡'),
      tab('discovery', 'Discovery', 'New & trending tokens', '🔭'),
      tab('portfolio', 'Portfolio', 'Your holdings & PnL', '💼'),
      tab('watchlist', 'Watchlist', 'Your saved markets', '⭐'),
      tab('copy-trading', 'Copy Trading', 'Follow top traders', '🔁'),
      tab('wallet-tracker', 'Wallet Tracker', 'Track on-chain wallets', '🔍'),
      tab('defi', 'DeFi Center', 'Lending, alerts, DCA', '🏦'),
      tab('copilot', 'AI Co-Pilot', 'Ask the trading assistant', '🤖'),
    ]
  }, [setTradingMode, goSpotTab])

  const trimmed = query.trim()
  const { data: popular } = usePopularTokens(chain)
  const { data: searchResults, isFetching } = useSearchTokens(trimmed, chain)

  const tokens = trimmed.length >= 1 ? searchResults : popular

  // Nav commands matching the query (always shown, filtered when typing).
  const matchedNav = useMemo(() => {
    if (!trimmed) return navCommands
    const q = trimmed.toLowerCase()
    return navCommands.filter((c) => c.keywords.toLowerCase().includes(q))
  }, [navCommands, trimmed])

  // Flat row list for keyboard nav: nav commands first, then tokens.
  const rows: Row[] = useMemo(() => {
    const navRows: Row[] = matchedNav.map((cmd) => ({ kind: 'nav', cmd }))
    const tokenRows: Row[] = (tokens ?? []).slice(0, 30).map((token) => ({ kind: 'token', token }))
    return [...navRows, ...tokenRows]
  }, [matchedNav, tokens])

  useEffect(() => {
    setActive(0)
  }, [trimmed, chain, rows.length])

  const close = () => setOpen(false)

  const pickToken = useCallback(
    (token: SwapToken) => {
      // One click = "trade this": token becomes the base, quote stays the
      // current quote (defaults to USDC). No confusing two-step selection.
      setSelectedChain(token.chain)
      setSelectedPair({ base: token, quote: selectedPair.quote ?? token })
      setTradingMode('spot')
      close()
    },
    [setSelectedChain, setSelectedPair, selectedPair.quote, setTradingMode]
  )

  const activateRow = useCallback(
    (row: Row | undefined) => {
      if (!row) return
      if (row.kind === 'nav') {
        row.cmd.run()
        close()
      } else {
        pickToken(row.token)
      }
    },
    [pickToken]
  )

  // Keyboard nav within the open palette.
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activateRow(rows[active])
    }
  }

  // Keep the active row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  let rowIndex = -1
  const navCount = matchedNav.length

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-terminal-border bg-terminal-panel shadow-2xl">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-terminal-border px-4 py-3">
          <span className="text-terminal-text-muted">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search tokens, or jump to anything…"
            className="flex-1 bg-transparent text-base text-terminal-text outline-none placeholder:text-terminal-text-muted"
          />
          <kbd className="rounded bg-terminal-bg-tertiary px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
            ESC
          </kbd>
        </div>

        {/* Chain filter chips */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-terminal-border px-4 py-2">
          <span className="mr-1 text-[10px] uppercase tracking-wide text-terminal-text-muted">Chain</span>
          {CHAINS.map((c) => (
            <button
              key={c.id}
              onClick={() => setChain(c.id)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                chain === c.id
                  ? 'bg-sakura-500/15 text-sakura-600 ring-1 ring-sakura-500/40'
                  : 'text-terminal-text-secondary hover:bg-terminal-bg-tertiary/60 hover:text-terminal-text'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {matchedNav.length > 0 && (
            <div className="px-2 pb-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-terminal-text-muted">
                Jump to
              </div>
              {matchedNav.map((cmd) => {
                rowIndex++
                const idx = rowIndex
                return (
                  <button
                    key={cmd.id}
                    data-row={idx}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => activateRow({ kind: 'nav', cmd })}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                      active === idx ? 'bg-sakura-500/10' : 'hover:bg-terminal-bg-tertiary/50'
                    }`}
                  >
                    <span className="text-base">{cmd.icon}</span>
                    <span className="flex-1">
                      <span className="text-sm font-medium text-terminal-text">{cmd.label}</span>
                      <span className="ml-2 text-xs text-terminal-text-muted">{cmd.hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="px-2 pt-1">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-terminal-text-muted">
              {trimmed ? 'Tokens' : 'Popular tokens'}
            </div>
            {tokens && tokens.length > 0 ? (
              tokens.slice(0, 30).map((token) => {
                rowIndex++
                const idx = rowIndex
                return (
                  <button
                    key={`${token.chain}-${token.address}`}
                    data-row={idx}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => activateRow({ kind: 'token', token })}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                      active === idx ? 'bg-sakura-500/10' : 'hover:bg-terminal-bg-tertiary/50'
                    }`}
                  >
                    <TokenLogo token={token} />
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-terminal-text">{token.symbol}</span>
                      <span className="ml-2 truncate text-xs text-terminal-text-muted">{token.name}</span>
                    </span>
                    <span className="shrink-0 rounded bg-terminal-bg-tertiary/70 px-1.5 py-0.5 text-[10px] uppercase text-terminal-text-muted">
                      {token.chain}
                    </span>
                    <span className="shrink-0 text-[11px] font-medium text-sakura-600">Trade →</span>
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-6 text-center text-sm text-terminal-text-muted">
                {isFetching ? 'Searching…' : trimmed ? 'No tokens found' : 'No tokens'}
              </div>
            )}
          </div>
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-terminal-border px-4 py-1.5 text-[10px] text-terminal-text-muted">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span className="ml-auto">{navCount + (tokens?.length ?? 0)} results</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
