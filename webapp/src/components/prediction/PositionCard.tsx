import type { PredictionPosition } from '../../types/prediction'

interface PositionCardProps {
  position: PredictionPosition
}

function formatUsd(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v)
}

export function PositionCard({ position }: PositionCardProps) {
  const isProfit = position.unrealizedPnl >= 0

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-heading font-semibold text-xs text-suwappu-text leading-tight line-clamp-1">
            {position.question}
          </p>
          <p className="text-[10px] text-suwappu-text-secondary mt-0.5">
            {position.outcome} &bull; {position.shares.toFixed(2)} shares
          </p>
        </div>
        <div className="text-right ml-2 flex-shrink-0">
          <p className={`font-heading font-bold text-sm ${isProfit ? 'text-green-600' : 'text-red-500'}`}>
            {isProfit ? '+' : ''}{formatUsd(position.unrealizedPnl)}
          </p>
          <p className={`text-[10px] font-medium ${isProfit ? 'text-green-600' : 'text-red-500'}`}>
            {isProfit ? '+' : ''}{position.unrealizedPnlPercent.toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="flex gap-4 text-[10px] text-suwappu-text-secondary">
        <span>Avg {formatUsd(position.avgEntryPrice)}</span>
        <span>Current {formatUsd(position.currentPrice)}</span>
        <span>Value {formatUsd(position.currentValue)}</span>
      </div>
    </div>
  )
}
