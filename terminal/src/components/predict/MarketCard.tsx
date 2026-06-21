import type { PredictionMarket } from '../../types/api'

interface Props {
  market: PredictionMarket
  selected?: boolean
  onSelect?: (market: PredictionMarket) => void
}

export function MarketCard({ market, selected, onSelect }: Props) {
  const yesPrice = market.outcomePrices[0] || 0
  const noPrice = market.outcomePrices[1] || 0

  return (
    <div
      onClick={() => onSelect?.(market)}
      className={`rounded-lg p-3 border transition-colors
        ${onSelect ? 'cursor-pointer' : ''}
        ${
          selected
            ? 'bg-sakura-500/10 border-sakura-500'
            : 'bg-terminal-bg border-terminal-border hover:border-terminal-border-active'
        }`}
    >
      <p className="text-sm text-terminal-text font-medium mb-2 leading-snug">
        {market.question}
      </p>

      <div className="flex gap-2 mb-2">
        <div className="flex-1 bg-bull-dim rounded px-2 py-1.5 text-center">
          <div className="text-xs text-terminal-text-secondary">Yes</div>
          <div className="text-sm font-mono text-bull font-semibold">
            {(yesPrice * 100).toFixed(0)}¢
          </div>
        </div>
        <div className="flex-1 bg-bear-dim rounded px-2 py-1.5 text-center">
          <div className="text-xs text-terminal-text-secondary">No</div>
          <div className="text-sm font-mono text-bear font-semibold">
            {(noPrice * 100).toFixed(0)}¢
          </div>
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-terminal-text-muted">
        <span>Vol: ${market.volume >= 1000 ? `${(market.volume / 1000).toFixed(0)}K` : market.volume.toFixed(0)}</span>
        {market.endDate && (
          <span>Ends: {new Date(market.endDate).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  )
}
