import type { WatchlistToken } from '../../hooks/useWatchlist'
import type { TokenPriceData } from '../../hooks/useWatchlistPrices'

const CHAIN_COLORS: Record<string, string> = {
  ethereum: 'bg-chain-ethereum',
  bsc: 'bg-chain-bsc',
  polygon: 'bg-chain-polygon',
  arbitrum: 'bg-chain-arbitrum',
  optimism: 'bg-chain-optimism',
  base: 'bg-chain-base',
  avalanche: 'bg-chain-avalanche',
  solana: 'bg-chain-solana',
  sui: 'bg-chain-sui',
}

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'ETH',
  bsc: 'BSC',
  polygon: 'POLY',
  arbitrum: 'ARB',
  optimism: 'OP',
  base: 'BASE',
  avalanche: 'AVAX',
  solana: 'SOL',
  sui: 'SUI',
}

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (price >= 1) return `$${price.toFixed(2)}`
  if (price >= 0.01) return `$${price.toFixed(4)}`
  if (price >= 0.0001) return `$${price.toFixed(6)}`
  return `$${price.toExponential(2)}`
}

function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}%`
}

interface Props {
  token: WatchlistToken
  priceData: TokenPriceData
  onRemove: (address: string, chain: string) => void
  onClick: (token: WatchlistToken) => void
}

export function WatchlistItem({ token, priceData, onRemove, onClick }: Props) {
  const chainColor = CHAIN_COLORS[token.chain] || 'bg-terminal-border-active'
  const chainLabel = CHAIN_LABELS[token.chain] || token.chain.slice(0, 4).toUpperCase()

  const { price, change24h, loading } = priceData
  const isPositive = change24h !== null && change24h >= 0
  const changeColor = change24h === null ? 'text-terminal-text-muted' : isPositive ? 'text-bull' : 'text-bear'

  return (
    <div
      className="group flex items-center gap-2 px-3 py-2 hover:bg-terminal-bg-tertiary transition-colors cursor-pointer"
      onClick={() => onClick(token)}
      title={token.name}
      data-testid="watchlist-item"
    >
      {/* Color indicator dot */}
      {change24h !== null && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPositive ? 'bg-bull' : 'bg-bear'}`}
        />
      )}

      {/* Symbol */}
      <span className="text-sm font-medium text-terminal-text min-w-[48px]">
        {token.symbol}
      </span>

      {/* Chain badge */}
      <span
        className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white ${chainColor}`}
      >
        {chainLabel}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Price */}
      <span className="text-xs font-mono text-terminal-text-secondary">
        {loading ? (
          <span className="inline-block w-12 h-3 bg-terminal-bg-tertiary rounded animate-shimmer" />
        ) : price !== null ? (
          formatPrice(price)
        ) : (
          '--'
        )}
      </span>

      {/* 24h change */}
      <span className={`text-xs font-mono min-w-[52px] text-right ${changeColor}`}>
        {loading ? (
          <span className="inline-block w-10 h-3 bg-terminal-bg-tertiary rounded animate-shimmer" />
        ) : change24h !== null ? (
          formatChange(change24h)
        ) : (
          '--'
        )}
      </span>

      {/* Remove button */}
      <button
        onClick={e => {
          e.stopPropagation()
          onRemove(token.address, token.chain)
        }}
        className="opacity-0 group-hover:opacity-100 text-terminal-text-muted hover:text-bear transition-all ml-1"
        title="Remove from watchlist"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
