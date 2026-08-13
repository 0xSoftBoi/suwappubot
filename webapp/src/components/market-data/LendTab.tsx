import { SkeletonCard } from '../ui'
import { EmptyDataset } from './EmptyDataset'
import { useMarketDataLendMarkets } from '../../hooks/useMarketData'
import { parseNum, formatCompactUsd, formatApy } from '../../lib/marketDataFormat'

export function LendTab() {
  const { data: markets, isLoading } = useMarketDataLendMarkets(50)

  return (
    <div className="space-y-3">
      {isLoading && (
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <SkeletonCard rows={5} variant="token" />
        </div>
      )}

      {!isLoading && (!markets || markets.length === 0) && (
        <EmptyDataset
          icon="\u{1F3E6}"
          title="No lending data yet"
          message="The capture service hasn't populated lending markets yet — expected before deploy."
        />
      )}

      {!isLoading && markets && markets.length > 0 && (
        <div className="space-y-2">
          {markets.map((m) => {
            const supplyApy = parseNum(m.supply_apy)
            const borrowApy = parseNum(m.borrow_apy)
            const tvl = parseNum(m.tvl)
            const util = parseNum(m.utilization)
            return (
              <div key={`${m.venue}-${m.market_id}`} className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-heading font-semibold text-sm text-suwappu-text">
                    {m.loan_symbol} <span className="text-suwappu-text-secondary">/ {m.collateral_symbol}</span>
                  </p>
                  <span className="text-[10px] text-suwappu-text-secondary capitalize">{m.venue}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-suwappu-sakura-light/40 rounded-suwappu-lg p-2">
                    <p className="text-[10px] text-suwappu-text-secondary">Supply APY</p>
                    <p className="font-heading font-semibold text-xs text-green-600">{formatApy(supplyApy)}</p>
                  </div>
                  <div className="bg-suwappu-sakura-light/40 rounded-suwappu-lg p-2">
                    <p className="text-[10px] text-suwappu-text-secondary">Borrow APY</p>
                    <p className="font-heading font-semibold text-xs text-red-500">{formatApy(borrowApy)}</p>
                  </div>
                  <div className="bg-suwappu-sakura-light/40 rounded-suwappu-lg p-2">
                    <p className="text-[10px] text-suwappu-text-secondary">TVL</p>
                    <p className="font-heading font-semibold text-xs text-suwappu-text">{formatCompactUsd(tvl)}</p>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="flex justify-between text-[10px] text-suwappu-text-secondary mb-1">
                    <span>Utilization</span>
                    <span>{Number.isFinite(util) ? `${(util <= 1 ? util * 100 : util).toFixed(1)}%` : '—'}</span>
                  </div>
                  <div className="h-1.5 bg-suwappu-sakura-light/50 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-suwappu-magenta-mid rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, (util <= 1 ? util * 100 : util) || 0))}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
