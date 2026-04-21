import { useEffect, useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { TerminalExecutionTicket, type TerminalExecutionMode, type TerminalExecutionSide } from '../../components/trade/TerminalExecutionTicket'
import { TerminalButton, TerminalSegmentedTabs, TerminalSelectPill, TerminalTextField } from '../../components/foundation/TerminalControls'
import { TerminalKeyValueRow } from '../../components/foundation/TerminalDataDisplay'
import { TerminalInset, TerminalMetricCard, TerminalPage, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../components/foundation/TerminalPrimitives'
import type { SwapQuote, SwapToken } from '../../types/api'
import { ethToKazeQuote, ethToken, kazeToken, solToKazeQuote, solToken } from '../_fixtures/terminal'

type RoutePack = 'direct' | 'bridge'

function reverseQuote(quote: SwapQuote): SwapQuote {
  return {
    ...quote,
    id: `${quote.id}-reverse`,
    fromToken: quote.toToken,
    toToken: quote.fromToken,
    fromAmount: quote.toAmount,
    toAmount: quote.fromAmount,
    fromAmountUsd: quote.toAmountUsd,
    toAmountUsd: quote.fromAmountUsd,
    exchangeRate: quote.exchangeRate === 0 ? 0 : 1 / quote.exchangeRate,
    minReceived: quote.fromAmount,
    route: `${quote.route} · reverse`,
  }
}

function ExecutionDeskLab() {
  const [mode, setMode] = useState<TerminalExecutionMode>('swap')
  const [side, setSide] = useState<TerminalExecutionSide>('buy')
  const [routePack, setRoutePack] = useState<RoutePack>('direct')
  const [query, setQuery] = useState('')
  const [flipped, setFlipped] = useState(false)
  const [amount, setAmount] = useState('0.75')
  const [slippage, setSlippage] = useState(0.45)
  const [showTpSl, setShowTpSl] = useState(true)
  const [tpPrice, setTpPrice] = useState('1.02')
  const [slPrice, setSlPrice] = useState('0.74')
  const [limitPrice, setLimitPrice] = useState('0.79')
  const [expiry, setExpiry] = useState('24h')
  const [totalBudget, setTotalBudget] = useState('2400')
  const [frequency, setFrequency] = useState('daily')
  const [orderCount, setOrderCount] = useState('8')
  const [lastAction, setLastAction] = useState('No action triggered yet')

  useEffect(() => {
    if (routePack === 'direct') {
      setAmount(flipped ? ethToKazeQuote.toAmount : ethToKazeQuote.fromAmount)
      setSlippage(0.45)
    } else {
      setAmount(flipped ? solToKazeQuote.toAmount : solToKazeQuote.fromAmount)
      setSlippage(1.2)
    }
  }, [routePack, flipped])

  const baseQuote = routePack === 'direct' ? ethToKazeQuote : solToKazeQuote
  const quote = useMemo(() => (flipped ? reverseQuote(baseQuote) : baseQuote), [baseQuote, flipped])

  const fromToken: SwapToken = flipped ? kazeToken : routePack === 'direct' ? ethToken : solToken
  const toToken: SwapToken = flipped ? (routePack === 'direct' ? ethToken : solToken) : kazeToken

  const promptPacks = [
    { id: 'route', label: 'Direct route', detail: 'clean execution' },
    { id: 'bridge', label: 'Bridge route', detail: 'cross-chain' },
    { id: 'risk', label: 'High-impact route', detail: 'monitor' },
  ].filter((pack) => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return true
    return pack.label.toLowerCase().includes(normalized) || pack.detail.toLowerCase().includes(normalized)
  })

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-7xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">execution slice</TerminalStatusPill>}
            title="Provider-free execution desk rebuild lab"
            description="This replaces the current trade panel stack with a Storybook-first execution desk. The purpose is to prove the terminal’s most important interaction in isolation before wiring it back into live quote and execution hooks."
            meta={
              <TerminalMetricCard
                label="Mode"
                value={`${routePack} ${mode}`}
                tone={routePack === 'direct' ? 'sky' : 'warm'}
              />
            }
          />

          <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
            <div className="grid gap-4">
              <TerminalInset className="grid gap-3">
                <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                  Desk controls
                </div>

                <TerminalSegmentedTabs
                  activeId={routePack}
                  onChange={(value) => setRoutePack(value as RoutePack)}
                  options={[
                    { id: 'direct', label: 'Direct', meta: 'best depth' },
                    { id: 'bridge', label: 'Bridge', meta: 'cross-chain' },
                  ]}
                />

                <TerminalTextField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter route packs"
                />

                <div className="grid gap-2">
                  {promptPacks.map((pack) => (
                    <button
                      key={pack.id}
                      onClick={() => {
                        if (pack.id === 'route') setRoutePack('direct')
                        if (pack.id === 'bridge') setRoutePack('bridge')
                        if (pack.id === 'risk') {
                          setRoutePack('bridge')
                          setMode('limit')
                        }
                      }}
                      className="border border-terminal-border bg-white px-3 py-3 text-left transition-colors hover:border-terminal-border-active hover:[box-shadow:var(--terminal-shadow-raised)] [border-radius:var(--terminal-radius-inset)]"
                    >
                      <div className="text-sm font-semibold text-terminal-text">{pack.label}</div>
                      <div className="terminal-theme-caption mt-1 text-[10px] uppercase text-terminal-text-muted">
                        {pack.detail}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <TerminalSelectPill
                    label="Normal"
                    detail="tape"
                    active={side === 'buy'}
                    onClick={() => setSide('buy')}
                  />
                  <TerminalSelectPill
                    label="Distribution"
                    detail="sell bias"
                    active={side === 'sell'}
                    onClick={() => setSide('sell')}
                  />
                  <TerminalSelectPill
                    label="Flip pair"
                    detail="stress test"
                    active={flipped}
                    onClick={() => setFlipped((current) => !current)}
                  />
                </div>
              </TerminalInset>

              <TerminalInset className="grid gap-2">
                <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
                  Composition notes
                </div>
                <TerminalKeyValueRow
                  label="What becomes reusable"
                  value="ticket shell"
                  detail="Side toggle, mode tabs, asset legs, execution controls, route summary, and CTA state all now live in one surface."
                />
                <TerminalKeyValueRow
                  label="Why this matters"
                  value="hook-free proof"
                  detail="We can test the core trade workflow without quote polling, auth state, or transaction plumbing obscuring the design."
                />
                <TerminalKeyValueRow
                  label="Last action"
                  value={lastAction}
                  detail="Useful for tightening CTA language and route confidence messaging."
                />
              </TerminalInset>
            </div>

            <div className="grid gap-4">
              <TerminalExecutionTicket
                mode={mode}
                side={side}
                fromToken={fromToken}
                toToken={toToken}
                amount={amount}
                onAmountChange={setAmount}
                quote={mode === 'dca' ? quote : quote}
                onFlip={() => setFlipped((current) => !current)}
                onModeChange={(nextMode) => {
                  setMode(nextMode)
                  if (nextMode === 'swap') setShowTpSl(true)
                }}
                onSideChange={setSide}
                slippage={slippage}
                slippageOptions={[
                  { value: 0.1, label: '0.1%' },
                  { value: 0.45, label: '0.45%' },
                  { value: 1.2, label: '1.2%' },
                  { value: 3, label: '3%' },
                ]}
                onSlippageChange={setSlippage}
                showTpSl={showTpSl}
                onToggleTpSl={() => setShowTpSl((current) => !current)}
                tpPrice={tpPrice}
                slPrice={slPrice}
                onTpPriceChange={setTpPrice}
                onSlPriceChange={setSlPrice}
                limitPrice={limitPrice}
                onLimitPriceChange={setLimitPrice}
                expiry={expiry}
                expiryOptions={[
                  { id: '1h', label: '1h' },
                  { id: '4h', label: '4h' },
                  { id: '24h', label: '24h' },
                  { id: '7d', label: '7d' },
                ]}
                onExpiryChange={setExpiry}
                totalBudget={totalBudget}
                onTotalBudgetChange={setTotalBudget}
                frequency={frequency}
                frequencyOptions={[
                  { id: 'hourly', label: 'Hourly' },
                  { id: 'daily', label: 'Daily' },
                  { id: 'weekly', label: 'Weekly' },
                ]}
                onFrequencyChange={setFrequency}
                orderCount={orderCount}
                onOrderCountChange={setOrderCount}
                onPrimaryAction={() => setLastAction(`primary: ${mode} ${side} ${toToken.symbol}`)}
                onSecondaryAction={() => setLastAction(`secondary: saved ${mode} draft`)}
              />

              <div className="grid gap-4 md:grid-cols-3">
                <TerminalMetricCard
                  label="What changed"
                  value="panel stack -> desk ticket"
                  detail="This replaces split swap, limit, and DCA panels with one shared execution shell."
                />
                <TerminalMetricCard
                  label="Theme leverage"
                  value="global surfaces"
                  detail="Radius, shadows, and surface density now move with the terminal theme toolbar."
                  tone="warm"
                />
                <TerminalMetricCard
                  label="Next live port"
                  value="replace SwapPanel shell"
                  detail="Once the ticket language feels right here, port it behind the real quote and execute hooks."
                  tone="sky"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <TerminalButton variant="secondary" onClick={() => setMode('swap')}>
                  Reset to swap
                </TerminalButton>
                <TerminalButton
                  onClick={() => {
                    setRoutePack('bridge')
                    setMode('limit')
                    setLastAction('preset: bridge limit review')
                  }}
                >
                  Stage bridge limit review
                </TerminalButton>
              </div>
            </div>
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Workbench/Execution Desk Rebuild Lab',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <ExecutionDeskLab />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
