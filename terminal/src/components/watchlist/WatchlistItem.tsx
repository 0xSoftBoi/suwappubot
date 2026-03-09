import type { WatchlistToken } from '../../hooks/useWatchlist'

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

interface Props {
  token: WatchlistToken
  onRemove: (address: string, chain: string) => void
  onClick: (token: WatchlistToken) => void
}

export function WatchlistItem({ token, onRemove, onClick }: Props) {
  const chainColor = CHAIN_COLORS[token.chain] || 'bg-terminal-border-active'
  const chainLabel = CHAIN_LABELS[token.chain] || token.chain.slice(0, 4).toUpperCase()

  return (
    <div
      className="group flex items-center gap-2 px-3 py-2 hover:bg-terminal-bg-tertiary transition-colors cursor-pointer"
      onClick={() => onClick(token)}
      title={token.name}
      data-testid="watchlist-item"
    >
      {/* Symbol */}
      <span className="text-sm font-medium text-terminal-text min-w-[60px]">
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

      {/* Price placeholder - monospace */}
      <span className="text-xs font-mono text-terminal-text-secondary">
        --
      </span>

      {/* 24h change placeholder */}
      <span className="text-xs font-mono text-terminal-text-muted min-w-[48px] text-right">
        --
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
