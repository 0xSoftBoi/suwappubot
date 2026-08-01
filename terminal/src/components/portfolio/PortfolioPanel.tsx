import { useState } from 'react'
import toast from 'react-hot-toast'
import { HoldingsTable } from './HoldingsTable'
import { TradeHistory } from './TradeHistory'
import { PnLSummary } from './PnLSummary'
import { EquityCurve } from './EquityCurve'
import { PerpsPositions } from '../perps/PositionsTable'
import { WalletModal } from '../wallet/WalletModal'
import { useAuth } from '../../contexts/AuthContext'
import { TerminalEmptyState } from '../foundation'

type Tab = 'holdings' | 'orders' | 'history' | 'positions'

const TABS: { id: Tab; label: string }[] = [
  { id: 'holdings', label: 'Holdings' },
  { id: 'positions', label: 'Positions' },
  { id: 'orders', label: 'Open Orders' },
  { id: 'history', label: 'History' },
]

export function PortfolioPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('holdings')
  const [wallet, setWallet] = useState<null | 'deposit' | 'withdraw'>(null)
  const { isAuthenticated } = useAuth()

  const openWallet = (tab: 'deposit' | 'withdraw') => {
    if (!isAuthenticated) {
      toast('Sign in to deposit or withdraw')
      return
    }
    setWallet(tab)
  }

  return (
    <div className="h-full flex flex-col">
      <WalletModal open={wallet !== null} onClose={() => setWallet(null)} initialTab={wallet ?? 'deposit'} />
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
        <div className="ml-auto flex items-center gap-2 py-1">
          <button className="terminal-button-secondary text-xs" onClick={() => openWallet('deposit')}>
            Deposit
          </button>
          <button className="terminal-button-secondary text-xs" onClick={() => openWallet('withdraw')}>
            Withdraw
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {!isAuthenticated ? (
          <div className="flex items-center justify-center h-full">
            <TerminalEmptyState
              kicker="Portfolio"
              title="Your positions live here"
              description="Connect a wallet from the header to see balances, PnL and trade history across every chain you trade — plus perps positions and open orders."
            />
          </div>
        ) : (
          <>
            {activeTab === 'holdings' && (
              <>
                <div className="p-3 space-y-3">
                  <PnLSummary />
                  <div className="h-[150px]">
                    <EquityCurve />
                  </div>
                </div>
                <HoldingsTable />
              </>
            )}
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
