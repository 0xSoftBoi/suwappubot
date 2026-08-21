import { useState } from 'react'
import type { LineData, Time } from 'lightweight-charts'
import { SkeletonCard } from '../ui'
import { EmptyDataset } from './EmptyDataset'
import { MarketLineChart } from './MarketLineChart'
import { useMarketDataPredictionMarkets, useMarketDataPredictionHistory } from '../../hooks/useMarketData'
import { parseNum, formatCompactUsd, formatProbability } from '../../lib/marketDataFormat'
import type { PredictionMarketRow } from '../../types/marketData'

export function PredictionsTab() {
  const [search, setSearch] = useState('')
  const { data: markets, isLoading } = useMarketDataPredictionMarkets(search, 50)
  const [selected, setSelected] = useState<PredictionMarketRow | null>(null)

  if (selected) {
    return <PredictionDetail market={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
        <input
          type="text"
          placeholder="Search prediction markets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2 text-sm outline-none placeholder:text-suwappu-text-secondary"
        />
      </div>

      {isLoading && (
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <SkeletonCard rows={5} variant="token" />
        </div>
      )}

      {!isLoading && (!markets || markets.length === 0) && (
        <EmptyDataset
          icon="\u{1F52E}"
          title="No prediction markets yet"
          message={
            search
              ? 'Try a different search.'
              : "The capture service hasn't populated prediction markets yet — expected before deploy."
          }
        />
      )}

      {!isLoading && markets && markets.length > 0 && (
        <div className="space-y-2">
          {markets.map((m) => {
            const prob = parseNum(m.price)
            const volume = parseNum(m.volume)
            return (
              <button
                key={`${m.venue}-${m.market_id}-${m.outcome}`}
                onClick={() => setSelected(m)}
                className="w-full bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 text-left hover:bg-suwappu-sakura-light/10 transition-colors"
              >
                <p className="font-heading font-semibold text-sm text-suwappu-text line-clamp-2">{m.question}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-suwappu-text-secondary capitalize">
                    {m.venue} · {m.outcome} · Vol {formatCompactUsd(volume)}
                  </span>
                  <span className="font-heading font-bold text-sm text-suwappu-magenta-mid">
                    {formatProbability(prob)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PredictionDetail({ market, onBack }: { market: PredictionMarketRow; onBack: () => void }) {
  const { data, isLoading } = useMarketDataPredictionHistory(market.market_id, market.outcome, 200)

  const points = data?.outcomes?.[market.outcome] || []
  const oddsSeries: LineData<Time>[] = points.map((p) => ({
    time: Math.floor(new Date(p.ts).getTime() / 1000) as unknown as Time,
    value: parseNum(p.price) * 100,
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
        All markets
      </button>

      <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-4">
        <h2 className="font-heading font-bold text-base text-suwappu-text">{market.question}</h2>
        <p className="text-xs text-suwappu-text-secondary capitalize mb-3">
          {market.venue} · {market.outcome} · odds history
        </p>
        {isLoading ? (
          <div className="h-[220px] flex items-center justify-center">
            <div className="animate-pulse text-suwappu-text-secondary text-sm">Loading history...</div>
          </div>
        ) : oddsSeries.length === 0 ? (
          <EmptyDataset
            icon="\u{1F4C9}"
            title="No odds history yet"
            message="The capture service hasn't backfilled history for this market yet."
          />
        ) : (
          <MarketLineChart data={oddsSeries} height={220} color="#ec4899" />
        )}
      </div>

      <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-4 space-y-2">
        <div className="flex justify-between">
          <span className="text-xs text-suwappu-text-secondary">Current probability</span>
          <span className="text-xs font-medium text-suwappu-text">{formatProbability(parseNum(market.price))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-suwappu-text-secondary">Volume</span>
          <span className="text-xs font-medium text-suwappu-text">{formatCompactUsd(parseNum(market.volume))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-suwappu-text-secondary">Liquidity</span>
          <span className="text-xs font-medium text-suwappu-text">{formatCompactUsd(parseNum(market.liquidity))}</span>
        </div>
        {market.end_date && (
          <div className="flex justify-between">
            <span className="text-xs text-suwappu-text-secondary">Ends</span>
            <span className="text-xs font-medium text-suwappu-text">
              {new Date(market.end_date).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
