import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { DataFreshnessHeader, CandlesTab, PerpsTab, PredictionsTab, LendTab } from '../components/market-data'
import { useMarketDataStatus } from '../hooks/useMarketData'

type Tab = 'candles' | 'perps' | 'predictions' | 'lend'

const TABS: { id: Tab; label: string }[] = [
  { id: 'candles', label: 'Candles' },
  { id: 'perps', label: 'Perps' },
  { id: 'predictions', label: 'Predictions' },
  { id: 'lend', label: 'Lend' },
]

export default function MarketData() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('candles')
  const { data: status, isLoading: statusLoading } = useMarketDataStatus()

  return (
    <AppLayout
      header={<AppHeader title="Market Data" showBack onBack={() => navigate(-1)} />}
      activeNav="data"
    >
      <div className="p-3 pb-20 space-y-3">
        {/* Coverage / freshness header */}
        <DataFreshnessHeader datasets={status?.venue_datasets} isLoading={statusLoading} />

        {/* Segmented control */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-1 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2 text-xs font-heading font-semibold rounded-suwappu-lg transition-colors ${
                tab === t.id
                  ? 'bg-suwappu-magenta-mid text-white'
                  : 'text-suwappu-text-secondary hover:bg-suwappu-sakura-light/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Active tab */}
        {tab === 'candles' && <CandlesTab />}
        {tab === 'perps' && <PerpsTab />}
        {tab === 'predictions' && <PredictionsTab />}
        {tab === 'lend' && <LendTab />}
      </div>
    </AppLayout>
  )
}
