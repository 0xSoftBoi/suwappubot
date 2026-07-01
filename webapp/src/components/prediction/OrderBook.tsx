interface OrderBookEntry {
  price: string
  size: string
}

interface OrderBookProps {
  bids: OrderBookEntry[]
  asks: OrderBookEntry[]
}

function maxSize(entries: OrderBookEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, parseFloat(e.size) || 0), 0) || 1
}

export function OrderBook({ bids, asks }: OrderBookProps) {
  const topBids = bids.slice(0, 5)
  const topAsks = asks.slice(0, 5)
  const maxBidSize = maxSize(topBids)
  const maxAskSize = maxSize(topAsks)

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[9px] text-suwappu-text-secondary font-medium px-1 mb-1">
        <span>Price</span>
        <span>Size</span>
      </div>

      {/* Asks (sells) - reversed so lowest ask is closest to center */}
      {[...topAsks].reverse().map((ask, i) => {
        const sizeNum = parseFloat(ask.size) || 0
        const pct = (sizeNum / maxAskSize) * 100
        return (
          <div key={`ask-${i}`} className="relative flex justify-between items-center px-1 py-0.5 text-xs">
            <div
              className="absolute inset-0 bg-red-100/60 rounded-xs"
              style={{ width: `${pct}%`, right: 0, left: 'auto' }}
            />
            <span className="relative text-red-600 font-mono">{parseFloat(ask.price).toFixed(2)}</span>
            <span className="relative text-suwappu-text-secondary font-mono">{sizeNum.toFixed(2)}</span>
          </div>
        )
      })}

      {/* Spread indicator */}
      {topBids.length > 0 && topAsks.length > 0 && (
        <div className="text-center text-[9px] text-suwappu-text-secondary py-0.5 border-y border-suwappu-sakura-mid/10">
          Spread: {(parseFloat(topAsks[0]?.price || '0') - parseFloat(topBids[0]?.price || '0')).toFixed(3)}
        </div>
      )}

      {/* Bids (buys) */}
      {topBids.map((bid, i) => {
        const sizeNum = parseFloat(bid.size) || 0
        const pct = (sizeNum / maxBidSize) * 100
        return (
          <div key={`bid-${i}`} className="relative flex justify-between items-center px-1 py-0.5 text-xs">
            <div
              className="absolute inset-0 bg-green-100/60 rounded-xs"
              style={{ width: `${pct}%` }}
            />
            <span className="relative text-green-600 font-mono">{parseFloat(bid.price).toFixed(2)}</span>
            <span className="relative text-suwappu-text-secondary font-mono">{sizeNum.toFixed(2)}</span>
          </div>
        )
      })}

      {topBids.length === 0 && topAsks.length === 0 && (
        <p className="text-center text-xs text-suwappu-text-secondary py-4">No orderbook data</p>
      )}
    </div>
  )
}
