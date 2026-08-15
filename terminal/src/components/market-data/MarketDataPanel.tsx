import { useState } from 'react'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalSegmentedTabs } from '../foundation'
import { StatusHeader } from './StatusHeader'
import { CandlesTab } from './CandlesTab'
import { PerpsTab } from './PerpsTab'
import { PredictionsTab } from './PredictionsTab'
import { LendTab } from './LendTab'
import { useMarketDataStatus } from '../../hooks/useMarketDataStore'

type DataSubTab = 'candles' | 'perps' | 'predictions' | 'lend'

const SUB_TABS: { id: DataSubTab; label: string }[] = [
  { id: 'candles', label: 'Candles' },
  { id: 'perps', label: 'Perps' },
  { id: 'predictions', label: 'Predictions' },
  { id: 'lend', label: 'Lend' },
]

// Surfaces the proprietary market-data store: OHLCV candles, perp funding/OI,
// prediction-market odds, and lending rates, all captured server-side and
// otherwise invisible in the terminal UI.
export function MarketDataPanel() {
  const [subTab, setSubTab] = useState<DataSubTab>('candles')
  const status = useMarketDataStatus()

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="market-data-panel">
      <div className="shrink-0 border-b border-terminal-border p-2">
        <StatusHeader status={status.data} isLoading={status.isLoading} error={status.error} />
        <div className="mt-2">
          <TerminalSegmentedTabs activeId={subTab} onChange={(id) => setSubTab(id as DataSubTab)} options={SUB_TABS} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {subTab === 'candles' && (
          <ErrorBoundary label="Market Data — Candles">
            <CandlesTab />
          </ErrorBoundary>
        )}
        {subTab === 'perps' && (
          <ErrorBoundary label="Market Data — Perps">
            <PerpsTab />
          </ErrorBoundary>
        )}
        {subTab === 'predictions' && (
          <ErrorBoundary label="Market Data — Predictions">
            <PredictionsTab />
          </ErrorBoundary>
        )}
        {subTab === 'lend' && (
          <ErrorBoundary label="Market Data — Lend">
            <LendTab />
          </ErrorBoundary>
        )}
      </div>
    </div>
  )
}
