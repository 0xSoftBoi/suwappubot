import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { PriceChart } from '../chart/PriceChart'
import { OrderBookPanel } from '../orderbook/OrderBookPanel'
import { RecentTradesPanel } from '../orderbook/RecentTradesPanel'
import { SwapPanel } from '../trade/SwapPanel'
import { PortfolioPanel } from '../portfolio/PortfolioPanel'
import { DiscoveryPanel } from '../discover/DiscoveryPanel'
import { CopyTradingDashboard } from '../copy/CopyTradingDashboard'
import { CopilotPanel } from '../copilot/CopilotPanel'
import { AlertsPanel } from '../alerts/AlertsPanel'
import { DCAManager } from '../dca/DCAManager'
import { LendingPanel } from '../lending/LendingPanel'
import { WalletTrackerPanel } from '../tracker/WalletTrackerPanel'
import { TweetMonitorPanel } from '../tweets/TweetMonitorPanel'
import { WatchlistPanel } from '../watchlist/WatchlistPanel'
import { useLayoutSizes } from '../../hooks/useLayoutSizes'
import { useBottomTab, type BottomTab } from '../../contexts/BottomTabContext'

const BOTTOM_TABS: { id: BottomTab; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'copy-trading', label: 'Copy Trading' },
  { id: 'wallet-tracker', label: 'Wallet Tracker' },
  { id: 'tweets', label: 'Tweets' },
  { id: 'defi', label: 'DeFi Center' },
  { id: 'copilot', label: 'AI Co-Pilot' },
]

export function TradingLayout() {
  const { sizes, onSizesChange } = useLayoutSizes()
  const { activeTab: bottomTab, setActiveTab: setBottomTab } = useBottomTab()

  return (
    <Allotment vertical onChange={onSizesChange.vertical}>
      {/* Top section: Chart + Order Panel */}
      <Allotment.Pane preferredSize={sizes.top} minSize={200}>
        <Allotment onChange={onSizesChange.horizontal}>
          {/* Chart area */}
          <Allotment.Pane preferredSize={sizes.chart} minSize={300}>
            <div className="h-full terminal-panel">
              <PriceChart />
            </div>
          </Allotment.Pane>

          {/* Order Book + Recent Trades */}
          <Allotment.Pane preferredSize={sizes.orderbook} minSize={220} maxSize={400}>
            <div className="h-full terminal-panel flex flex-col">
              <Allotment vertical>
                <Allotment.Pane preferredSize="60%">
                  <OrderBookPanel />
                </Allotment.Pane>
                <Allotment.Pane preferredSize="40%">
                  <RecentTradesPanel />
                </Allotment.Pane>
              </Allotment>
            </div>
          </Allotment.Pane>

          {/* Order/Swap panel */}
          <Allotment.Pane preferredSize={sizes.order} minSize={320} maxSize={500}>
            <div className="h-full terminal-panel overflow-y-auto">
              <SwapPanel />
            </div>
          </Allotment.Pane>
        </Allotment>
      </Allotment.Pane>

      {/* Bottom section: Tabbed panels */}
      <Allotment.Pane preferredSize={sizes.bottom} minSize={120}>
        <div className="h-full flex flex-col terminal-panel">
          {/* Bottom tab bar */}
          <div className="flex items-center border-b border-terminal-border px-2 shrink-0" data-testid="bottom-tabs">
            {BOTTOM_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setBottomTab(tab.id)}
                className={`terminal-tab ${bottomTab === tab.id ? 'terminal-tab-active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {bottomTab === 'portfolio' && <PortfolioPanel />}
            {bottomTab === 'discovery' && <DiscoveryPanel />}
            {bottomTab === 'watchlist' && <WatchlistPanel />}
            {bottomTab === 'copy-trading' && <CopyTradingDashboard />}
            {bottomTab === 'wallet-tracker' && <WalletTrackerPanel />}
            {bottomTab === 'tweets' && <TweetMonitorPanel />}
            {bottomTab === 'defi' && (
              <div className="h-full grid grid-cols-3 divide-x divide-terminal-border">
                <AlertsPanel />
                <DCAManager />
                <LendingPanel />
              </div>
            )}
            {bottomTab === 'copilot' && <CopilotPanel />}
          </div>
        </div>
      </Allotment.Pane>
    </Allotment>
  )
}
