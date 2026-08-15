import { useNavigate } from 'react-router-dom'
import { OutcomeBar } from './OutcomeBar'
import type { PredictionMarket } from '../../types/prediction'

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function formatEndDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  if (days < 0) return 'Ended'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 30) return `${days}d left`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface MarketCardProps {
  market: PredictionMarket
}

export function MarketCard({ market }: MarketCardProps) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate(`/predict/${market.conditionId}`)}
      className="w-full bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 text-left transition-shadow hover:shadow-suwappu-2"
    >
      <div className="flex gap-3 mb-2">
        {market.image && (
          <img
            src={market.image}
            alt=""
            className="w-10 h-10 rounded-lg object-cover shrink-0"
          />
        )}
        <p className="font-heading font-semibold text-sm text-suwappu-text leading-tight line-clamp-2 flex-1">
          {market.question}
        </p>
      </div>

      <OutcomeBar outcomes={market.outcomes} prices={market.outcomePrices} />

      <div className="flex items-center gap-3 mt-2 text-[10px] text-suwappu-text-secondary">
        <span>Vol {formatVolume(market.volume)}</span>
        <span>Liq {formatVolume(market.liquidity)}</span>
        {market.endDate && <span>{formatEndDate(market.endDate)}</span>}
        {market.category && (
          <span className="ml-auto px-1.5 py-0.5 bg-suwappu-sakura-light/50 rounded-full text-[9px] font-medium">
            {market.category}
          </span>
        )}
      </div>
    </button>
  )
}
