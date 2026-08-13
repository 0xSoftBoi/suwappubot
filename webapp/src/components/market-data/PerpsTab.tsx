import { useState } from 'react'
import type { LineData, Time } from 'lightweight-charts'
import { SkeletonCard } from '../ui'
import { EmptyDataset } from './EmptyDataset'
import { MarketLineChart } from './MarketLineChart'
import { useMarketDataPerpMarkets, useMarketDataPerpHistory } from '../../hooks/useMarketData'
import { parseNum, formatCompactUsd, formatPercent, formatPrice } from '../../lib/marketDataFormat'
import type { PerpMarket } from '../../types/marketData'

export function PerpsTab() {
  const { data: markets, isLoading } = useMarketDataPerpMarkets(100)
  const [selected, setSelected] = useState<PerpMarket | null>(null)

  if (selected) {
    return <PerpDetail market={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="space-y-3">
      {isLoading && (
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <SkeletonCard rows={5} variant="token" />
        </div>
      )}

      {!isLoading && (!markets || markets.length === 0) && (
        <EmptyDataset
          icon="\u{1F4C8}"
          title="No perps data yet"
          message="The capture service hasn't populated perp funding/OI yet — expected before deploy."
        />
      )}

      {!isLoading && markets && markets.length > 0 && (
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden divide-y divide-suwappu-sakura-light/50">
          {markets.map((m) => {
            const funding = parseNum(m.funding_rate)
            const oi = parseNum(m.open_interest)
            const mark = parseNum(m.mark_price)
            return (
              <button
                key={`${m.venue}-${m.symbol}`}
                onClick={() => setSelected(m)}
                className="w-full flex items-center justify-between p-3 hover:bg-suwappu-sakura-light/20 transition-colors text-left"
              >
                <div>
                  <p className="font-heading font-semibold text-sm text-suwappu-text">{m.symbol}</p>
                  <p className="text-[10px] text-suwappu-text-secondary capitalize">{m.venue} · OI {formatCompactUsd(oi)}</p>
                </div>
                <div className="text-right">
                  <p className="font-heading font-semibold text-sm text-suwappu-text">${formatPrice(mark)}</p>
                  <p className={`text-[10px] font-medium ${funding >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {formatPercent(funding, 4)} funding
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PerpDetail({ market, onBack }: { market: PerpMarket; onBack: () => void }) {
  const { data, isLoading } = useMarketDataPerpHistory(market.symbol, market.venue, 200)

  const fundingSeries: LineData<Time>[] = (data?.metrics || []).map((m) => ({
    time: Math.floor(new Date(m.ts).getTime() / 1000) as unknown as Time,
    value: parseNum(m.funding_rate) * 100,
  }))

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs font-medium text-suwappu-magenta-mid"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        All perps
      </button>

      <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-4">
        <h2 className="font-heading font-bold text-lg text-suwappu-text">{market.symbol}</h2>
        <p className="text-xs text-suwappu-text-secondary capitalize mb-3">{market.venue} · funding rate history</p>
        {isLoading ? (
          <div className="h-[220px] flex items-center justify-center">
            <div className="animate-pulse text-suwappu-text-secondary text-sm">Loading history...</div>
          </div>
        ) : fundingSeries.length === 0 ? (
          <EmptyDataset
            icon="\u{1F4C9}"
            title="No funding history yet"
            message="The capture service hasn't backfilled history for this symbol yet."
          />
        ) : (
          <MarketLineChart data={fundingSeries} height={220} color="#a855f7" />
        )}
      </div>

      <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-4 space-y-2">
        <div className="flex justify-between">
          <span className="text-xs text-suwappu-text-secondary">Mark price</span>
          <span className="text-xs font-medium text-suwappu-text">${formatPrice(parseNum(market.mark_price))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-suwappu-text-secondary">Index price</span>
          <span className="text-xs font-medium text-suwappu-text">${formatPrice(parseNum(market.index_price))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-suwappu-text-secondary">Open interest</span>
          <span className="text-xs font-medium text-suwappu-text">{formatCompactUsd(parseNum(market.open_interest))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-suwappu-text-secondary">24h volume</span>
          <span className="text-xs font-medium text-suwappu-text">{formatCompactUsd(parseNum(market.volume_24h))}</span>
        </div>
      </div>
    </div>
  )
}
