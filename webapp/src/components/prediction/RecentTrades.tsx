interface Trade {
  id: string
  timestamp: string
  side: string
  outcome: string
  price: string
  size: string
}

interface RecentTradesProps {
  trades: Trade[]
}

function formatTime(ts: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function RecentTrades({ trades }: RecentTradesProps) {
  if (trades.length === 0) {
    return (
      <p className="text-center text-xs text-suwappu-text-secondary py-6">No recent trades</p>
    )
  }

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[9px] text-suwappu-text-secondary font-medium px-1 mb-1">
        <span>Time</span>
        <span>Side</span>
        <span>Price</span>
        <span>Size</span>
      </div>
      {trades.map((trade) => {
        const isBuy = trade.side.toUpperCase() === 'BUY'
        return (
          <div
            key={trade.id}
            className="flex justify-between items-center px-1 py-1 text-xs"
          >
            <span className="text-suwappu-text-secondary w-16 text-[10px]">
              {formatTime(trade.timestamp)}
            </span>
            <span className={`font-medium w-10 text-center ${isBuy ? 'text-green-600' : 'text-red-500'}`}>
              {isBuy ? 'BUY' : 'SELL'}
            </span>
            <span className="font-mono text-suwappu-text w-14 text-right">
              {parseFloat(trade.price).toFixed(3)}
            </span>
            <span className="font-mono text-suwappu-text-secondary w-14 text-right">
              {parseFloat(trade.size).toFixed(2)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
