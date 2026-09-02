import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { PriceChart } from '../chart/PriceChart'
import { OrderBookPanel } from '../orderbook/OrderBookPanel'
import { RecentTradesPanel } from '../orderbook/RecentTradesPanel'
import { SwapPanel } from '../trade/SwapPanel'
import { PortfolioPanel } from '../portfolio/PortfolioPanel'
import { ErrorBoundary } from '../ErrorBoundary'
import { useLayoutSizes } from '../../hooks/useLayoutSizes'
import { useBottomTab, type BottomTab } from '../../contexts/BottomTabContext'
import { useTrading } from '../../contexts/TradingContext'
import { MarketInfoBar } from './MarketInfoBar'
import { useIsMobile } from '../../hooks/useIsMobile'

// Chart + book + tape + swap stay eager: they are the default spot desk and
// should render as soon as the entry chunk executes. Everything below the fold
// or behind a mode/tab becomes an on-demand chunk.
const SignalsFeed = lazy(() =>
  import('../signals/SignalsFeed').then((m) => ({ default: m.SignalsFeed })),
)
const DiscoveryPanel = lazy(() =>
  import('../discover/DiscoveryPanel').then((m) => ({ default: m.DiscoveryPanel })),
)
const CopyTradingDashboard = lazy(() =>
  import('../copy/CopyTradingDashboard').then((m) => ({ default: m.CopyTradingDashboard })),
)
const CopilotPanel = lazy(() =>
  import('../copilot/CopilotPanel').then((m) => ({ default: m.CopilotPanel })),
)
const AlertsPanel = lazy(() =>
  import('../alerts/AlertsPanel').then((m) => ({ default: m.AlertsPanel })),
)
const DCAManager = lazy(() =>
  import('../dca/DCAManager').then((m) => ({ default: m.DCAManager })),
)
const LendingPanel = lazy(() =>
  import('../lending/LendingPanel').then((m) => ({ default: m.LendingPanel })),
)
const WalletTrackerPanel = lazy(() =>
  import('../tracker/WalletTrackerPanel').then((m) => ({ default: m.WalletTrackerPanel })),
)
const TweetMonitorPanel = lazy(() =>
  import('../tweets/TweetMonitorPanel').then((m) => ({ default: m.TweetMonitorPanel })),
)
const WatchlistPanel = lazy(() =>
  import('../watchlist/WatchlistPanel').then((m) => ({ default: m.WatchlistPanel })),
)
const IntelPanel = lazy(() =>
  import('../intel/IntelPanel').then((m) => ({ default: m.IntelPanel })),
)
const BridgeRoute = lazy(() =>
  import('../../routes/BridgeRoute').then((m) => ({ default: m.BridgeRoute })),
)
const PerpsWorkspace = lazy(() =>
  import('../perps/PerpsWorkspace').then((m) => ({ default: m.PerpsWorkspace })),
)
const PredictWorkspace = lazy(() =>
  import('../predict/PredictWorkspace').then((m) => ({ default: m.PredictWorkspace })),
)
const ReferralsPanel = lazy(() =>
  import('../referrals/ReferralsPanel').then((m) => ({ default: m.ReferralsPanel })),
)
const RewardsPanel = lazy(() =>
  import('../rewards/RewardsPanel').then((m) => ({ default: m.RewardsPanel })),
)
const PendingApprovalsPanel = lazy(() =>
  import('../agent-control/PendingApprovalsPanel').then((m) => ({
    default: m.PendingApprovalsPanel,
  })),
)
const AuditLogPanel = lazy(() =>
  import('../agent-control/AuditLogPanel').then((m) => ({ default: m.AuditLogPanel })),
)
const MarketDataPanel = lazy(() =>
  import('../market-data/MarketDataPanel').then((m) => ({ default: m.MarketDataPanel })),
)
const CurvePoolsPanel = lazy(() =>
  import('../curve/CurvePoolsPanel').then((m) => ({ default: m.CurvePoolsPanel })),
)

function DeferredPanel({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}

const BOTTOM_TABS: { id: BottomTab; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'signals', label: 'Signals' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'intel', label: 'Token Intel' },
  { id: 'data', label: 'Data' },
  { id: 'copy-trading', label: 'Copy Trading' },
  { id: 'wallet-tracker', label: 'Wallet Tracker' },
  { id: 'tweets', label: 'Tweets' },
  { id: 'defi', label: 'DeFi Center' },
  { id: 'curve', label: 'Curve' },
  { id: 'copilot', label: 'AI Co-Pilot' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'rewards', label: 'Cashback' },
  { id: 'approvals', label: 'Agent Approvals' },
  { id: 'audit', label: 'Agent Audit' },
]

type MobileTab = 'chart' | 'swap' | 'earn' | 'portfolio' | 'more'

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
    id: 'earn',
    label: 'Earn',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185zM9.75 9h.008v.008H9.75V9zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 4.5h.008v.008h-.008V13.5zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0" />
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

// Curve and Portfolio are first-class mobile nav tabs, so the "More" strip
// doesn't repeat them on phones.
const MOBILE_MORE_TABS = BOTTOM_TABS.filter((t) => t.id !== 'curve' && t.id !== 'portfolio')

function MobileLayout() {
  const [mobileTab, setMobileTab] = useState<MobileTab>('chart')
  const { activeTab: persistedBottomTab, setActiveTab: setBottomTab } = useBottomTab()
  // Curve and Portfolio live in the main mobile nav, not the More strip; if the
  // persisted tab is one of those (e.g. the 'portfolio' default), fall back to
  // Signals so More never renders a strip with no active tab.
  const bottomTab =
    persistedBottomTab === 'curve' || persistedBottomTab === 'portfolio'
      ? 'signals'
      : persistedBottomTab

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<MobileTab>).detail
      if (detail) setMobileTab(detail)
    }
    window.addEventListener(REQUEST_MOBILE_TAB_EVENT, handler)
    return () => window.removeEventListener(REQUEST_MOBILE_TAB_EVENT, handler)
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MarketInfoBar />
      {/* Main content area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {mobileTab === 'chart' && (
          <div className="h-full terminal-panel">
            <ErrorBoundary label="Chart">
              <PriceChart />
            </ErrorBoundary>
          </div>
        )}

        {mobileTab === 'swap' && (
          <div className="terminal-mobile-scroll h-full min-h-0 overflow-y-auto terminal-panel">
            <SwapPanel />
          </div>
        )}

        {mobileTab === 'earn' && (
          <div className="h-full min-h-0 terminal-panel">
            <DeferredPanel>
              <ErrorBoundary label="Curve">
                <CurvePoolsPanel />
              </ErrorBoundary>
            </DeferredPanel>
          </div>
        )}

        {mobileTab === 'portfolio' && (
          <div className="h-full min-h-0 terminal-panel">
            <ErrorBoundary label="Portfolio">
              <PortfolioPanel />
            </ErrorBoundary>
          </div>
        )}

        {mobileTab === 'more' && (
          <div className="h-full min-h-0 flex flex-col terminal-panel">
            {/* Bottom tab bar — scrollable horizontally on mobile */}
            <div className="flex items-center border-b border-terminal-border px-1 shrink-0 overflow-x-auto" data-testid="bottom-tabs">
              {MOBILE_MORE_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setBottomTab(tab.id)}
                  className={`terminal-tab min-h-11 whitespace-nowrap text-xs ${bottomTab === tab.id ? 'terminal-tab-active' : ''}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <DeferredPanel>
                {/* One boundary around every bottom panel, keyed by tab so a
                    crash in one (DeFi Center's lending cards took down the
                    whole terminal) is contained to that tab and clears when
                    the trader switches away. */}
                <ErrorBoundary key={bottomTab} label={bottomTab}>
                {bottomTab === 'signals' && <SignalsFeed />}
                {bottomTab === 'discovery' && (
                  <ErrorBoundary label="Discovery">
                    <DiscoveryPanel />
                  </ErrorBoundary>
                )}
                {bottomTab === 'watchlist' && <WatchlistPanel />}
                {bottomTab === 'intel' && (
                  <ErrorBoundary label="Token Intel">
                    <IntelPanel />
                  </ErrorBoundary>
                )}
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
                {bottomTab === 'approvals' && (
                  <ErrorBoundary label="Agent Approvals">
                    <PendingApprovalsPanel />
                  </ErrorBoundary>
                )}
                {bottomTab === 'audit' && (
                  <ErrorBoundary label="Agent Audit">
                    <AuditLogPanel />
                  </ErrorBoundary>
                )}
                {bottomTab === 'data' && (
                  <ErrorBoundary label="Market Data">
                    <MarketDataPanel />
                  </ErrorBoundary>
                )}
                </ErrorBoundary>
              </DeferredPanel>
            </div>
          </div>
        )}
      </div>

      {/* Fixed bottom navigation bar */}
      <nav className="terminal-mobile-nav flex min-h-14 shrink-0 items-center justify-around border-t border-terminal-border bg-terminal-panel px-1">
        {MOBILE_NAV_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMobileTab(tab.id)}
            aria-current={mobileTab === tab.id ? 'page' : undefined}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 transition-colors
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
          {/* Scrolls horizontally: at laptop widths the strip is wider than the
              viewport and the last tabs (Agent Approvals / Audit) were clipped
              off-screen with no way to reach them. */}
          <div className="flex items-center border-b border-terminal-border px-2 shrink-0 overflow-x-auto terminal-mobile-scroll" data-testid="bottom-tabs">
            {BOTTOM_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setBottomTab(tab.id)}
                className={`terminal-tab whitespace-nowrap ${bottomTab === tab.id ? 'terminal-tab-active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            <DeferredPanel>
              {/* One boundary around every bottom panel, keyed by tab so a
                  crash in one panel (DeFi Center's lending cards took the
                  whole terminal down) stays inside that tab and clears when
                  the trader switches away. */}
              <ErrorBoundary key={bottomTab} label={bottomTab}>
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
              {bottomTab === 'intel' && (
                <ErrorBoundary label="Token Intel">
                  <IntelPanel />
                </ErrorBoundary>
              )}
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
              {bottomTab === 'curve' && (
                <ErrorBoundary label="Curve">
                  <CurvePoolsPanel />
                </ErrorBoundary>
              )}
              {bottomTab === 'copilot' && <CopilotPanel />}
              {bottomTab === 'referrals' && <ReferralsPanel />}
              {bottomTab === 'rewards' && <RewardsPanel />}
              {bottomTab === 'approvals' && (
                <ErrorBoundary label="Agent Approvals">
                  <PendingApprovalsPanel />
                </ErrorBoundary>
              )}
              {bottomTab === 'audit' && (
                <ErrorBoundary label="Agent Audit">
                  <AuditLogPanel />
                </ErrorBoundary>
              )}
              {bottomTab === 'data' && (
                <ErrorBoundary label="Market Data">
                  <MarketDataPanel />
                </ErrorBoundary>
              )}
              </ErrorBoundary>
            </DeferredPanel>
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
          <DeferredPanel>
            <PerpsWorkspace />
          </DeferredPanel>
        </ErrorBoundary>
      </div>
    )
  }
  if (tradingMode === 'bridge') {
    return (
      <div className="h-full">
        <ErrorBoundary label="Bridge">
          <DeferredPanel>
            <BridgeRoute />
          </DeferredPanel>
        </ErrorBoundary>
      </div>
    )
  }
  if (tradingMode === 'predict') {
    return (
      <div className="h-full">
        <ErrorBoundary label="Predict">
          <DeferredPanel>
            <PredictWorkspace />
          </DeferredPanel>
        </ErrorBoundary>
      </div>
    )
  }

  return isMobile ? <MobileLayout /> : <DesktopLayout />
}
