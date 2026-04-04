import type { Meta, StoryObj } from '@storybook/react-vite'
import { MermaidDiagram } from '../_components/MermaidDiagram'

const diagrams = [
  {
    title: 'Design System Inventory',
    description:
      'Maps the current frontend from foundations through templates so state work stays attached to actual UI layers.',
    chart: `flowchart LR
    F[Foundations\\nTokens\\nColor / Type / Motion] --> A[Atoms\\nTierBadge\\nTrustScoreBadge\\nSlippageControl]
    A --> M[Molecules\\nWatchlistItem\\nAlertCard\\nCreateAlertForm\\nAddWalletForm]
    M --> O[Organisms\\nWatchlistPanel\\nAlertsPanel\\nWalletTrackerPanel\\nSwapPanel]
    O --> T[Templates\\nTradingLayout\\nDesktopLayout\\nMobileLayout]
    T --> P[Pages and Workspaces\\nTrading routes\\nTask views\\nStorybook state lab]
    `,
  },
  {
    title: 'Trading Workspace Template',
    description:
      'Shows the main template split between desktop and mobile, including fullscreen chart mode and tab-driven secondary surfaces.',
    chart: `stateDiagram-v2
    [*] --> Boot
    Boot --> Desktop : viewport >= md
    Boot --> Mobile : viewport < md

    state Desktop {
      [*] --> MultiPane
      MultiPane --> ChartFullscreen : toggleChartFullscreen()
      ChartFullscreen --> MultiPane : exit fullscreen
      MultiPane --> PortfolioTab : bottomTab = portfolio
      PortfolioTab --> DiscoveryTab : select discovery
      DiscoveryTab --> WatchlistTab : select watchlist
      WatchlistTab --> DefiTab : select defi
      DefiTab --> CopilotTab : select copilot
      CopilotTab --> PortfolioTab : select portfolio
    }

    state Mobile {
      [*] --> MobileChart
      MobileChart --> MobileSwap : mobileTab = swap
      MobileSwap --> MobileMore : mobileTab = more
      MobileMore --> MorePortfolio : bottomTab = portfolio
      MorePortfolio --> MoreDiscovery : select discovery
      MoreDiscovery --> MoreWatchlist : select watchlist
      MoreWatchlist --> MoreCopilot : select copilot
      MoreCopilot --> MobileChart : mobileTab = chart
    }
    `,
  },
  {
    title: 'Swap Execution State Machine',
    description:
      'Tracks the frontend from quote editing into execution, then through the API lifecycle defined in the terminal types.',
    chart: `stateDiagram-v2
    [*] --> Idle
    Idle --> Editing : choose pair / amount
    Editing --> Quoting : request quote
    Quoting --> QuoteReady : quote success
    Quoting --> QuoteError : quote failure
    QuoteError --> Editing : adjust inputs
    QuoteReady --> Executing : confirm swap
    Executing --> Pending : status = pending
    Pending --> Signed : status = signed
    Signed --> Submitted : status = submitted
    Submitted --> Completed : status = completed
    Submitted --> Failed : status = failed
    Failed --> Editing : retry
    Completed --> Idle : new swap
    `,
  },
  {
    title: 'Alert Lifecycle',
    description:
      'Covers the form state, submission state, and the alert-card lifecycle after creation.',
    chart: `stateDiagram-v2
    [*] --> Empty
    Empty --> Editing : start input
    Editing --> Invalid : missing token or target
    Invalid --> Editing : correct fields
    Editing --> Ready : token + type + target valid
    Ready --> Submitting : create alert
    Submitting --> Active : request success
    Submitting --> Error : request failure
    Error --> Editing : retry
    Active --> Triggered : market condition met
    Active --> Inactive : disabled
    Inactive --> Active : re-enable
    Triggered --> Archived : dismiss / delete
    Active --> Archived : delete
    `,
  },
  {
    title: 'Watchlist Row States',
    description:
      'Models the live row states used in Storybook: loading, positive, negative, missing price, and removal.',
    chart: `stateDiagram-v2
    [*] --> Untracked
    Untracked --> Loading : add token
    Loading --> Positive : price loads with gain
    Loading --> Negative : price loads with loss
    Loading --> Unavailable : no price result
    Positive --> Positive : polling refresh
    Positive --> Negative : reversal
    Negative --> Positive : rebound
    Negative --> Negative : polling refresh
    Unavailable --> Loading : refetch
    Positive --> Removed : remove token
    Negative --> Removed : remove token
    Unavailable --> Removed : remove token
    Removed --> [*]
    `,
  },
  {
    title: 'Wallet Tracking Form',
    description:
      'Represents the local validation and tracking flow behind AddWalletForm and the tracker entry surface.',
    chart: `stateDiagram-v2
    [*] --> Empty
    Empty --> TypingAddress : input address
    TypingAddress --> Invalid : regex fail
    Invalid --> TypingAddress : fix address
    TypingAddress --> LabelOptional : regex pass
    LabelOptional --> Ready : keep blank or add label
    Ready --> Tracking : submit
    Tracking --> Tracked : add to list
    Tracked --> WalletProfile : select tracked wallet
    WalletProfile --> ActivityFeed : inspect activity
    ActivityFeed --> Tracked : back
    `,
  },
  {
    title: 'Status Semantics',
    description:
      'Captures the badge systems as explicit state ladders so visual semantics stay consistent while we redesign.',
    chart: `stateDiagram-v2
    state TrustScore {
      [*] --> Safe
      Safe --> Caution : score < 80
      Caution --> Danger : score < 50
      Danger --> Caution : score recovers
      Caution --> Safe : score >= 80
    }

    state TierProgression {
      [*] --> Bronze
      Bronze --> Silver
      Silver --> Gold
      Gold --> Platinum
      Platinum --> Diamond
    }
    `,
  },
]

function StateMapsPage() {
  return (
    <div className="grid gap-4">
      <section className="terminal-panel p-5">
        <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-sakura-400">
          Frontend State Lab
        </div>
        <h1 className="text-2xl font-semibold text-terminal-text">Mermaid State Maps</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-terminal-text-secondary">
          This page is the current behavioral map for the terminal frontend. It connects design-system
          layers, interactive components, and template transitions so we can redesign with explicit
          state coverage instead of ad hoc screens.
        </p>
      </section>

      {diagrams.map((diagram) => (
        <section key={diagram.title} className="grid gap-3 lg:grid-cols-[280px_1fr]">
          <div className="terminal-panel p-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-terminal-text-muted">
              State Map
            </div>
            <h2 className="text-lg font-semibold text-terminal-text">{diagram.title}</h2>
            <p className="mt-2 text-sm leading-6 text-terminal-text-secondary">
              {diagram.description}
            </p>
          </div>
          <MermaidDiagram title={diagram.title} chart={diagram.chart} />
        </section>
      ))}
    </div>
  )
}

const meta = {
  title: 'Foundations/State Maps',
  tags: ['autodocs'],
  render: () => <StateMapsPage />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
