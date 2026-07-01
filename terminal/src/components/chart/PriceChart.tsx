import { useState, useCallback } from 'react'
import { ChartToolbar } from './ChartToolbar'
import { CandleChartCore } from './CandleChartCore'
import { useChartData } from '../../hooks/useChartData'
import { usePair } from '../../contexts/PairContext'
import { useTrading } from '../../contexts/TradingContext'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D'] as const
type Interval = (typeof INTERVALS)[number]

// Spot price chart. Resolves OHLCV from the selected pair's base token address
// (Coinbase for ETH/USDC, GeckoTerminal pools otherwise) and renders it through
// the shared CandleChartCore.
export function PriceChart() {
  const { chartInterval: interval, setChartInterval } = useTrading()
  const [chartType, setChartType] = useState<'candle' | 'line'>('candle')
  const { selectedPair, selectedChain } = usePair()

  const tokenAddress = selectedPair.base?.address ?? null
  const { data: candles, isLoading } = useChartData(tokenAddress, selectedChain, interval)

  const handleIntervalChange = useCallback(
    (i: string) => setChartInterval(i as Interval),
    [setChartInterval]
  )

  const pairLabel =
    selectedPair.base && selectedPair.quote
      ? `${selectedPair.base.symbol}/${selectedPair.quote.symbol}`
      : null

  return (
    <div className="h-full flex flex-col">
      <ChartToolbar
        interval={interval}
        onIntervalChange={handleIntervalChange}
        chartType={chartType}
        onChartTypeChange={setChartType}
      />
      <div className="flex-1 min-h-0">
        <CandleChartCore
          candles={candles}
          isLoading={isLoading}
          chartType={chartType}
          label={pairLabel}
          selectPrompt={{ title: 'Select a trading pair', subtitle: 'Use Cmd+K to search' }}
          emptyState={{
            title: 'Chart provider is not connected yet.',
            subtitle: 'Live OHLCV will appear here when the feed is wired.',
          }}
        />
      </div>
    </div>
  )
}
