import { usePair } from '../../contexts/PairContext'
import { openCommandPalette } from './CommandPalette'

// The header's primary discovery affordance: a search-bar-styled button that
// opens the command palette. Shows the current pair so it doubles as the
// "what am I trading" indicator. Replaces the old cramped pair dropdown.
export function MarketSearchButton({ compact = false }: { compact?: boolean }) {
  const { selectedPair } = usePair()
  const pair =
    selectedPair.base && selectedPair.quote
      ? `${selectedPair.base.symbol}/${selectedPair.quote.symbol}`
      : null

  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label="Search markets and tokens"
      className="terminal-theme-control flex h-8 items-center gap-2 rounded-[8px] px-3 text-sm transition-colors hover:text-terminal-text"
    >
      <span className="text-terminal-text-muted">⌕</span>
      {pair ? (
        <span className="font-mono font-semibold text-terminal-text">{pair}</span>
      ) : (
        <span className="text-terminal-text-secondary">Search markets…</span>
      )}
      {!compact && (
        <span className="hidden text-terminal-text-muted sm:inline">·</span>
      )}
      {!compact && (
        <span className="hidden text-xs text-terminal-text-muted sm:inline">tokens, modes, panels</span>
      )}
      <kbd className="ml-1 rounded bg-terminal-bg-tertiary px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
        ⌘K
      </kbd>
    </button>
  )
}
