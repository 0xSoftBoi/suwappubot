import { useEffect, useState } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { PriceChart } from '../chart/PriceChart'
import { OrderBookPanel } from '../orderbook/OrderBookPanel'
import { RecentTradesPanel } from '../orderbook/RecentTradesPanel'
import { SwapPanel } from '../trade/SwapPanel'
import { PortfolioPanel } from '../portfolio/PortfolioPanel'
import { SignalsFeed } from '../signals/SignalsFeed'
import { DiscoveryPanel } from '../discover/DiscoveryPanel'
import { CopyTradingDashboard } from '../copy/CopyTradingDashboard'
import { CopilotPanel } from '../copilot/CopilotPanel'
import { AlertsPanel } from '../alerts/AlertsPanel'
import { DCAManager } from '../dca/DCAManager'
import { LendingPanel } from '../lending/LendingPanel'
import { WalletTrackerPanel } from '../tracker/WalletTrackerPanel'
import { TweetMonitorPanel } from '../tweets/TweetMonitorPanel'
import { WatchlistPanel } from '../watchlist/WatchlistPanel'
import { PerpsWorkspace } from '../perps/PerpsWorkspace'
import { PredictWorkspace } from '../predict/PredictWorkspace'
import { ReferralsPanel } from '../referrals/ReferralsPanel'
import { RewardsPanel } from '../rewards/RewardsPanel'
import { PendingApprovalsPanel } from '../agent-control/PendingApprovalsPanel'
import { AuditLogPanel } from '../agent-control/AuditLogPanel'
import { ErrorBoundary } from '../ErrorBoundary'
import { useLayoutSizes } from '../../hooks/useLayoutSizes'
import { useBottomTab, type BottomTab } from '../../contexts/BottomTabContext'
import { useTrading } from '../../contexts/TradingContext'
import { MarketInfoBar } from './MarketInfoBar'
import { useIsMobile } from '../../hooks/useIsMobile'

const BOTTOM_TABS: { id: BottomTab; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'signals', label: 'Signals' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'copy-trading', label: 'Copy Trading' },
  { id: 'wallet-tracker', label: 'Wallet Tracker' },
  { id: 'tweets', label: 'Tweets' },
  { id: 'defi', label: 'DeFi Center' },
  { id: 'copilot', label: 'AI Co-Pilot' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'rewards', label: 'Cashback' },
  { id: 'agent-control', label: 'Agent Control' },
]

function AgentControlPlanePanel({ mobile }: { mobile?: boolean }) {
  return (
    <div className={`h-full flex ${mobile ? 'flex-col divide-y' : 'divide-x'} divide-terminal-border overflow-y-auto`}>
      <div className={mobile ? 'min-h-[280px]' : 'flex-1'}>
        <ErrorBoundary label="Pending Approvals">
          <PendingApprovalsPanel />
        </ErrorBoundary>
      </div>
      <div className={mobile ? 'min-h-[280px]' : 'flex-1'}>
        <ErrorBoundary label="Audit Log">
          <AuditLogPanel />
        </ErrorBoundary>
      </div>
    </div>
  )
}

type MobileTab = 'chart' | 'swap' | 'more'

// Lets components outside this file (e.g. the onboarding FirstRunChecklist)
// request a switch of the mobile bottom-nav tab, which is otherwise local
// state to `MobileLayout`. Mirrors the `openCommandPalette` custom-event
// pattern already used by CommandPalette.
const REQUEST_MOBILE_TAB_EVENT = 'suwappu:request-mobile-tab'
export function requestMobileTab(tab: MobileTab) {
  window.dispatchEvent(new CustomEvent<MobileTab>(REQUEST_MOBILE_TAB_EVENT, { detail: tab }))
}

const MOBILE_NAV_TABS: { id: MobileTab; label: string; icon: JSX.Element }[] = [
  {
    id: 'chart',
    label: 'Chart',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    id: 'swap',
    label: 'Swap',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    id: 'more',
    label: 'More',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
]

function MobileLayout() {
  const [mobileTab, setMobileTab] = useState<MobileTab>('chart')
  const { activeTab: bottomTab, setActiveTab: setBottomTab } = useBottomTab()

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<MobileTab>).detail
      if (detail) setMobileTab(detail)
    }
    window.addEventListener(REQUEST_MOBILE_TAB_EVENT, handler)
    return () => window.removeEventListener(REQUEST_MOBILE_TAB_EVENT, handler)
  }, [])

  return (
    <div className="flex flex-col h-full">
      <MarketInfoBar />
      {/* Main content area */}
      <div className="flex-1 overflow-hidden">
        {mobileTab === 'chart' && (
          <div className="h-full terminal-panel">
            <ErrorBoundary label="Chart">
              <PriceChart />
            </ErrorBoundary>
          </div>
        )}

        {mobileTab === 'swap' && (
          <div className="h-full terminal-panel overflow-y-auto">
            <SwapPanel />
          </div>
        )}

        {mobileTab === 'more' && (
          <div className="h-full flex flex-col terminal-panel">
            {/* Bottom tab bar — scrollable horizontally on mobile */}
            <div className="flex items-center border-b border-terminal-border px-1 shrink-0 overflow-x-auto" data-testid="bottom-tabs">
              {BOTTOM_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setBottomTab(tab.id)}
                  className={`terminal-tab whitespace-nowrap text-xs ${bottomTab === tab.id ? 'terminal-tab-active' : ''}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {bottomTab === 'portfolio' && (
                <ErrorBoundary label="Portfolio">
                  <PortfolioPanel />
                </ErrorBoundary>
              )}
              {bottomTab === 'signals' && <SignalsFeed />}
              {bottomTab === 'discovery' && (
                <ErrorBoundary label="Discovery">
                  <DiscoveryPanel />
                </ErrorBoundary>
              )}
              {bottomTab === 'watchlist' && <WatchlistPanel />}
              {bottomTab === 'copy-trading' && <CopyTradingDashboard />}
              {bottomTab === 'wallet-tracker' && <WalletTrackerPanel />}
              {bottomTab === 'tweets' && <TweetMonitorPanel />}
              {bottomTab === 'defi' && (
                <div className="h-full flex flex-col divide-y divide-terminal-border overflow-y-auto">
                  <div className="min-h-[200px]"><AlertsPanel /></div>
                  <div className="min-h-[200px]"><DCAManager /></div>
                  <div className="min-h-[200px]"><LendingPanel /></div>
                </div>
              )}
              {bottomTab === 'copilot' && <CopilotPanel />}
              {bottomTab === 'referrals' && <ReferralsPanel />}
              {bottomTab === 'rewards' && <RewardsPanel />}
              {bottomTab === 'agent-control' && <AgentControlPlanePanel mobile />}
            </div>
          </div>
        )}
      </div>

      {/* Fixed bottom navigation bar */}
      <nav className="flex items-center justify-around h-14 border-t border-terminal-border bg-terminal-panel shrink-0 px-2">
        {MOBILE_NAV_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setMobileTab(tab.id)}
            className={`flex flex-col items-center gap-0.5 px-4 py-1 rounded-lg transition-colors
              ${mobileTab === tab.id
                ? 'text-sakura-400'
                : 'text-terminal-text-muted hover:text-terminal-text-secondary'
              }`}
          >
            {tab.icon}
            <span className="text-[10px] font-medium">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function DesktopLayout() {
  const { sizes, onSizesChange } = useLayoutSizes()
  const { activeTab: bottomTab, setActiveTab: setBottomTab } = useBottomTab()
  const { chartFullscreen, toggleChartFullscreen } = useTrading()

  // Fullscreen chart: render just the chart panel over everything
  if (chartFullscreen) {
    return (
      <div className="h-full relative">
        <div className="h-full terminal-panel">
          <ErrorBoundary label="Chart">
            <PriceChart />
          </ErrorBoundary>
        </div>
        <button
          onClick={toggleChartFullscreen}
          className="absolute top-2 right-2 z-20 px-2 py-1 rounded text-xs
                     bg-terminal-bg-tertiary/80 border border-terminal-border
                     text-terminal-text-secondary hover:text-terminal-text
                     backdrop-blur-sm transition-colors"
          title="Exit fullscreen (F)"
        >
          Exit Fullscreen
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
    <MarketInfoBar />
    <div className="flex-1 overflow-hidden">
    <Allotment vertical onChange={onSizesChange.vertical}>
      {/* Top section: Chart + Order Panel */}
      <Allotment.Pane preferredSize={sizes.top} minSize={200}>
        <Allotment onChange={onSizesChange.horizontal}>
          {/* Chart area */}
          <Allotment.Pane preferredSize={sizes.chart} minSize={300}>
            <div className="h-full terminal-panel">
              <ErrorBoundary label="Chart">
                <PriceChart />
              </ErrorBoundary>
            </div>
          </Allotment.Pane>

          {/* Order Book + Recent Trades */}
          <Allotment.Pane preferredSize={sizes.orderbook} minSize={220} maxSize={400}>
            <div className="h-full terminal-panel flex flex-col">
              <Allotment vertical>
                <Allotment.Pane preferredSize="60%">
                  <ErrorBoundary label="Order Book">
                    <OrderBookPanel />
                  </ErrorBoundary>
                </Allotment.Pane>
                <Allotment.Pane preferredSize="40%">
                  <ErrorBoundary label="Recent Trades">
                    <RecentTradesPanel />
                  </ErrorBoundary>
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
            {bottomTab === 'portfolio' && (
              <ErrorBoundary label="Portfolio">
                <PortfolioPanel />
              </ErrorBoundary>
            )}
              {bottomTab === 'signals' && <SignalsFeed />}
            {bottomTab === 'discovery' && (
              <ErrorBoundary label="Discovery">
                <DiscoveryPanel />
              </ErrorBoundary>
            )}
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
            {bottomTab === 'referrals' && <ReferralsPanel />}
            {bottomTab === 'rewards' && <RewardsPanel />}
            {bottomTab === 'agent-control' && <AgentControlPlanePanel />}
          </div>
        </div>
      </Allotment.Pane>
    </Allotment>
    </div>
    </div>
  )
}

export function TradingLayout() {
  const isMobile = useIsMobile()
  const { tradingMode } = useTrading()

  // Perps + Predict are first-class top-level workspaces, swapped in via the
  // Header ModeSwitch. Each handles its own mobile/desktop layout internally.
  if (tradingMode === 'perps') {
    return (
      <div className="h-full">
        <ErrorBoundary label="Perps">
          <PerpsWorkspace />
        </ErrorBoundary>
      </div>
    )
  }
  if (tradingMode === 'predict') {
    return (
      <div className="h-full">
        <ErrorBoundary label="Predict">
          <PredictWorkspace />
        </ErrorBoundary>
      </div>
    )
  }

  return isMobile ? <MobileLayout /> : <DesktopLayout />
}
