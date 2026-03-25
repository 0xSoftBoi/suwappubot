interface OutcomeBarProps {
  outcomes: string[]
  prices: string[]
}

const OUTCOME_COLORS = [
  { bg: 'bg-green-500', text: 'text-green-700' },
  { bg: 'bg-red-500', text: 'text-red-700' },
  { bg: 'bg-blue-500', text: 'text-blue-700' },
  { bg: 'bg-yellow-500', text: 'text-yellow-700' },
  { bg: 'bg-purple-500', text: 'text-purple-700' },
]

export function OutcomeBar({ outcomes, prices }: OutcomeBarProps) {
  const parsedPrices = prices.map((p) => parseFloat(p) || 0)
  const total = parsedPrices.reduce((s, v) => s + v, 0) || 1

  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
        {parsedPrices.map((price, i) => {
          const pct = (price / total) * 100
          if (pct < 1) return null
          const color = OUTCOME_COLORS[i % OUTCOME_COLORS.length]
          return (
            <div
              key={i}
              className={`${color.bg} transition-all duration-300`}
              style={{ width: `${pct}%` }}
            />
          )
        })}
      </div>
      <div className="flex justify-between gap-2">
        {outcomes.map((outcome, i) => {
          const pct = ((parsedPrices[i] || 0) / total) * 100
          const color = OUTCOME_COLORS[i % OUTCOME_COLORS.length]
          return (
            <span key={i} className={`text-[10px] font-medium ${color.text}`}>
              {outcome} {pct.toFixed(0)}%
            </span>
          )
        })}
      </div>
    </div>
  )
}
