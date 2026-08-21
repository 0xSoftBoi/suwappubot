import { useState } from 'react'
import type { CandlestickData, Time } from 'lightweight-charts'
import { TokenChart } from '../charts/TokenChart'
import { EmptyDataset } from './EmptyDataset'
import { useMarketDataOhlcv } from '../../hooks/useMarketData'
import { parseNum } from '../../lib/marketDataFormat'

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB']
const TIMEFRAMES = ['1m', '5m', '1h', '1d']
const CHAIN = 'ethereum'

export function CandlesTab() {
  const [symbol, setSymbol] = useState('BTC')
  const [timeframe, setTimeframe] = useState('1h')

  const { data, isLoading } = useMarketDataOhlcv(symbol, CHAIN, timeframe, 200)

  const candles: CandlestickData<Time>[] = (data?.candles || []).map((c) => ({
    time: (Math.floor(new Date(c.ts).getTime() / 1000)) as unknown as Time,
    open: parseNum(c.open),
    high: parseNum(c.high),
    low: parseNum(c.low),
    close: parseNum(c.close),
  }))

  return (
    <div className="space-y-3">
      {/* Symbol selector */}
      <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`px-3 py-1.5 text-xs font-heading font-semibold rounded-suwappu-pill whitespace-nowrap transition-colors ${
                symbol === s
                  ? 'bg-suwappu-magenta-mid text-white'
                  : 'bg-suwappu-sakura-light/50 text-suwappu-text-secondary hover:bg-suwappu-sakura-light'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-2">
        {isLoading ? (
          <div className="h-[300px] flex items-center justify-center">
            <div className="animate-pulse text-suwappu-text-secondary text-sm">Loading chart...</div>
          </div>
        ) : candles.length === 0 ? (
          <div className="p-3">
            <EmptyDataset
              icon="\u{1F4C9}"
              title={`No candles for ${symbol} ${timeframe}`}
              message="The capture service hasn't backfilled this symbol/timeframe yet — expected before deploy."
            />
          </div>
        ) : (
          <CandleChartWrapper candles={candles} timeframe={timeframe} onTimeframeChange={setTimeframe} />
        )}
      </div>

      {data && (
        <p className="text-[10px] text-suwappu-text-secondary text-center">
          Source: {data.source} · {candles.length} candles
        </p>
      )}
    </div>
  )
}

// TokenChart hardcodes its own timeframe buttons (5m/15m/1h/4h/1d) — wrap it so
// the Data page's own selector (1m/5m/1h/1d) stays the source of truth while
// still reusing the chart-rendering logic.
function CandleChartWrapper({
  candles,
  timeframe,
  onTimeframeChange,
}: {
  candles: CandlestickData<Time>[]
  timeframe: string
  onTimeframeChange: (tf: string) => void
}) {
  return (
    <div>
      <div className="flex gap-1 mb-2 px-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              timeframe === tf
                ? 'bg-suwappu-magenta-mid text-white'
                : 'text-suwappu-text-secondary hover:bg-suwappu-sakura-light'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>
      <TokenChart data={candles} timeframe="" onTimeframeChange={() => {}} height={280} />
    </div>
  )
}
