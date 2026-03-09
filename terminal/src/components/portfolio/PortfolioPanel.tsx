import { useState } from 'react'
import { HoldingsTable } from './HoldingsTable'
import { TradeHistory } from './TradeHistory'
import { PerpsPositions } from '../perps/PositionsTable'
import { useAuth } from '../../contexts/AuthContext'

type Tab = 'holdings' | 'orders' | 'history' | 'positions'

const TABS: { id: Tab; label: string }[] = [
  { id: 'holdings', label: 'Holdings' },
  { id: 'positions', label: 'Positions' },
  { id: 'orders', label: 'Open Orders' },
  { id: 'history', label: 'History' },
]

export function PortfolioPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('holdings')
  const { isAuthenticated } = useAuth()

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-terminal-border px-2 shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`terminal-tab ${activeTab === tab.id ? 'terminal-tab-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {!isAuthenticated ? (
          <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
            Connect wallet to view portfolio
          </div>
        ) : (
          <>
            {activeTab === 'holdings' && <HoldingsTable />}
            {activeTab === 'positions' && <PerpsPositions />}
            {activeTab === 'orders' && (
              <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
                No open orders
              </div>
            )}
            {activeTab === 'history' && <TradeHistory />}
          </>
        )}
      </div>
    </div>
  )
}
