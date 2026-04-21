import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { ChartToolbar } from '../../components/chart/ChartToolbar'
import { ChatMessage } from '../../components/copilot/ChatMessage'
import { SuggestedCommands } from '../../components/copilot/SuggestedCommands'
import { SecurityBadge } from '../../components/discover/SecurityBadge'
import { TierBadge } from '../../components/points/TierBadge'
import { TrustScoreBadge } from '../../components/discover/TrustScoreBadge'
import { QuoteComparison } from '../../components/swap/QuoteComparison'
import { SlippageControl } from '../../components/swap/SlippageControl'
import { OrderTabs } from '../../components/trade/OrderTabs'
import { WalletProfileCard } from '../../components/tracker/WalletProfileCard'
import {
  SummerBreezeStoryFrame,
  SummerBreezeSurface,
} from '../_components/SummerBreezeStoryFrame'
import {
  cautionSecurity,
  copilotQuoteCardData,
  ethToUsdcQuote,
  portfolioSummaryData,
  safeSecurity,
  trackedWallet,
  walletActivities,
  walletStats,
} from '../_fixtures/terminal'

type LabMode = 'audit' | 'reroll'
type TradeTab = 'swap' | 'limit' | 'dca'
type ChartType = 'candle' | 'line'

function RebuildMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'warm' | 'sky'
}) {
  const toneClass =
    tone === 'warm'
      ? 'bg-[#FFF4E1] text-[#8B642A] border-[#F0D49B]'
      : tone === 'sky'
        ? 'bg-[#EFF8FF] text-[#3972A3] border-[#CFE7F6]'
        : 'bg-[#FFF9F0] text-[#7B6B58] border-[#ECE0CB]'

  return (
    <div className={`rounded-2xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-[0.22em]">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  )
}

function RebuildChecklist({ mode }: { mode: LabMode }) {
  const items =
    mode === 'audit'
      ? [
          'Separate terminal primitives from provider-heavy panels.',
          'Keep stories driven by fixtures and local state, not app boot logic.',
          'Use Storybook as the visual source of truth before touching the app shell.',
        ]
      : [
          'Recompose pieces into calmer boards with stronger hierarchy.',
          'Tune spacing, surface contrast, and copy in Storybook first.',
          'Promote successful patterns back into the real terminal app after review.',
        ]

  return (
    <div className="grid gap-2">
      {items.map((item, index) => (
        <div
          key={item}
          className="rounded-2xl border border-[#ECE0CB] bg-[#FFFDF8] px-3 py-2 text-sm text-[#6E5B49]"
        >
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#E9D6B7] bg-white text-[10px] font-semibold text-[#9B7A48]">
            {index + 1}
          </span>
          {item}
        </div>
      ))}
    </div>
  )
}

function TerminalRebuildLab({ mode }: { mode: LabMode }) {
  const [slippage, setSlippage] = useState(0.5)
  const [orderTab, setOrderTab] = useState<TradeTab>('swap')
  const [interval, setInterval] = useState('15m')
  const [chartType, setChartType] = useState<ChartType>('candle')
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null)

  return (
    <SummerBreezeStoryFrame
      eyebrow="Terminal workbench"
      title="Terminal rebuild lab"
      description="This is the top-level Storybook entry for the terminal. It runs without app-provider drama and gives us a controlled place to pull components apart, compare them, and reroll the interaction and visual language."
      metricLabel="Mode"
      metricValue={mode}
    >
      <div className="grid gap-4">
        <SummerBreezeSurface
          title="How to use this lab"
          description="Start here instead of booting the whole terminal app. Change one component at a time, validate the composition here, then back-port the pattern into the real product."
          meta="provider-free"
        >
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <RebuildChecklist mode={mode} />
            <div className="grid gap-3">
              <RebuildMetric label="Stories" value="Current + new terminal stories" tone="warm" />
              <RebuildMetric label="Approach" value="fixtures + local state" />
              <RebuildMetric label="Direction" value="editorial, calmer, brighter terminal" tone="sky" />
            </div>
          </div>
        </SummerBreezeSurface>

        <div className="grid gap-4 xl:grid-cols-2">
          <SummerBreezeSurface
            title="Trade controls"
            description="Small terminal controls that shape the trading workflow."
            meta="atoms + molecules"
          >
            <div className="grid gap-4">
              <div className="overflow-hidden rounded-[22px] border border-[#2A232A] bg-[#151217]">
                <ChartToolbar
                  interval={interval}
                  onIntervalChange={setInterval}
                  chartType={chartType}
                  onChartTypeChange={setChartType}
                />
              </div>

              <div className="rounded-[22px] border border-[#ECE0CB] bg-[#FFF9F0] p-4">
                <OrderTabs active={orderTab} onSelect={setOrderTab} />
                <div className="mt-4">
                  <SlippageControl value={slippage} onChange={setSlippage} />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <RebuildMetric label="Chart" value={`${interval} / ${chartType}`} />
                <RebuildMetric label="Order tab" value={orderTab} tone="warm" />
                <RebuildMetric label="Slippage" value={`${slippage.toFixed(2)}%`} tone="sky" />
              </div>
            </div>
          </SummerBreezeSurface>

          <SummerBreezeSurface
            title="Trust and route readouts"
            description="The terminal needs tiny dense readouts that still feel calm and understandable."
            meta="market semantics"
          >
            <div className="grid gap-4">
              <div className="rounded-[22px] border border-[#ECE0CB] bg-white/95 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <TierBadge tier="Gold" points={12840} />
                  <TrustScoreBadge score={91} level="safe" />
                  <SecurityBadge security={safeSecurity} />
                  <SecurityBadge security={cautionSecurity} compact />
                </div>
                <QuoteComparison quote={ethToUsdcQuote} />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <RebuildMetric label="Status badges" value="kept compact" />
                <RebuildMetric label="Security" value="expandable detail" tone="warm" />
                <RebuildMetric label="Route card" value="review before execute" tone="sky" />
              </div>
            </div>
          </SummerBreezeSurface>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <SummerBreezeSurface
            title="Wallet operator surface"
            description="A tracked wallet card is the kind of surface we can now redesign here without dragging the whole tracker panel with it."
            meta="isolated panel"
          >
            <div className="rounded-[22px] border border-[#2A232A] bg-[#151217] text-[#F6EEF1]">
              <WalletProfileCard
                wallet={trackedWallet}
                stats={walletStats}
                recentTrades={walletActivities}
                onRemove={() => undefined}
                onBack={() => undefined}
              />
            </div>
          </SummerBreezeSurface>

          <SummerBreezeSurface
            title="Copilot fragments"
            description="Use this corner to tune chat tone, embedded quote cards, and command vocabulary."
            meta="conversation system"
          >
            <div className="grid gap-3">
              <div className="rounded-[22px] border border-[#2A232A] bg-[#151217] p-3">
                <ChatMessage
                  role="assistant"
                  type="quote"
                  content="Route looks clean. You can execute now or tighten slippage if you want a stricter fill."
                  data={copilotQuoteCardData}
                  timestamp={Date.now() - 1000 * 60 * 3}
                />
                <ChatMessage
                  role="assistant"
                  type="portfolio"
                  content="Your wallet is still concentrated in ETH and stablecoins."
                  data={portfolioSummaryData}
                  timestamp={Date.now() - 1000 * 60}
                />
              </div>

              <div className="rounded-[22px] border border-[#2A232A] bg-[#151217] p-2">
                <SuggestedCommands onSelect={setSelectedCommand} />
              </div>

              <div className="rounded-2xl border border-[#ECE0CB] bg-[#FFF9F0] px-3 py-2 text-xs text-[#6E5B49]">
                {selectedCommand
                  ? `Selected prompt: ${selectedCommand}`
                  : 'Choose a prompt to test command wording before wiring it into the app.'}
              </div>
            </div>
          </SummerBreezeSurface>
        </div>
      </div>
    </SummerBreezeStoryFrame>
  )
}

const meta = {
  title: 'Workbench/Terminal Rebuild Lab',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    mode: 'audit' as LabMode,
  },
  render: ({ mode }) => (
    <div className="min-h-screen bg-[linear-gradient(180deg,#FFFEFB_0%,#FFF6E9_100%)] p-6">
      <TerminalRebuildLab mode={mode} />
    </div>
  ),
} satisfies Meta<{ mode: LabMode }>

export default meta

type Story = StoryObj<typeof meta>

export const Audit: Story = {}

export const Reroll: Story = {
  args: {
    mode: 'reroll',
  },
}
