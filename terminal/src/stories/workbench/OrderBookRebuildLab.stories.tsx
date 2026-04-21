import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { TerminalIconButton, TerminalSegmentedTabs, TerminalSelectPill } from '../../components/foundation/TerminalControls'
import { TerminalMetricCard, TerminalPage, TerminalPanel, TerminalPanelHeader, TerminalStatusPill, TerminalInset } from '../../components/foundation/TerminalPrimitives'
import { TerminalOrderBookDepthRow } from '../../components/orderbook/TerminalOrderBookDepthRow'
import type { OrderBookLevel } from '../../hooks/useOrderBook'

type ViewMode = 'both' | 'bids' | 'asks'
type PrecisionStep = 0.01 | 0.1 | 1

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}

function generateSide(basePrice: number, levels: number, step: number, side: 'bid' | 'ask') {
  const result: OrderBookLevel[] = []
  let cumulative = 0

  for (let index = 0; index < levels; index++) {
    const offset = (index + 1) * step
    const price =
      side === 'bid'
        ? roundToStep(basePrice - offset, step)
        : roundToStep(basePrice + offset, step)
    const size = parseFloat((2.4 + index * 0.42 + (side === 'bid' ? 0.4 : 0.2)).toFixed(4))
    cumulative += size
    result.push({
      price: parseFloat(price.toFixed(Math.max(2, -Math.log10(step)))),
      size,
      total: parseFloat(cumulative.toFixed(4)),
    })
  }

  return result
}

function buildBook(step: PrecisionStep) {
  const midPrice = roundToStep(3245.5, step)
  const bids = generateSide(midPrice, 12, step, 'bid')
  const asks = generateSide(midPrice, 12, step, 'ask')
  const spread = asks[0].price - bids[0].price
  const spreadPercent = (spread / midPrice) * 100
  const maxTotal = Math.max(bids[bids.length - 1].total, asks[asks.length - 1].total)

  return {
    bids,
    asks,
    midPrice,
    spread: parseFloat(spread.toFixed(2)),
    spreadPercent: parseFloat(spreadPercent.toFixed(4)),
    maxTotal,
  }
}

function TimeAndSales() {
  const trades = [
    { id: 't1', price: 3245.52, size: 0.8124, time: '14:32:11', side: 'buy' as const },
    { id: 't2', price: 3245.47, size: 1.2011, time: '14:32:09', side: 'sell' as const },
    { id: 't3', price: 3245.49, size: 0.4421, time: '14:32:06', side: 'buy' as const },
    { id: 't4', price: 3245.44, size: 2.3042, time: '14:32:03', side: 'sell' as const },
  ]

  return (
    <TerminalInset>
      <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-terminal-text-muted">
        Time and sales
      </div>
      <div className="grid gap-1 font-mono text-[11px]">
        <div className="grid grid-cols-3 gap-3 px-3 text-[10px] uppercase tracking-[0.14em] text-terminal-text-muted">
          <span>Price</span>
          <span className="text-right">Size</span>
          <span className="text-right">Time</span>
        </div>
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="grid grid-cols-3 gap-3 rounded-suwappu-xl border border-terminal-border bg-white/90 px-3 py-1.5"
          >
            <span className={trade.side === 'buy' ? 'text-bull' : 'text-bear'}>
              {trade.price.toFixed(2)}
            </span>
            <span className="text-right text-terminal-text-secondary">{trade.size.toFixed(4)}</span>
            <span className="text-right text-terminal-text-muted">{trade.time}</span>
          </div>
        ))}
      </div>
    </TerminalInset>
  )
}

function OrderBookLab() {
  const [viewMode, setViewMode] = useState<ViewMode>('both')
  const [precision, setPrecision] = useState<PrecisionStep>(0.01)

  const book = useMemo(() => buildBook(precision), [precision])

  const showBids = viewMode === 'both' || viewMode === 'bids'
  const showAsks = viewMode === 'both' || viewMode === 'asks'

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-7xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">order book slice</TerminalStatusPill>}
            title="Provider-free order book rebuild lab"
            description="This is the depth panel reconstructed in Storybook. It lets us redesign row rhythm, spread treatment, precision controls, and the relationship to recent trades without the live market hook."
            meta={<TerminalMetricCard label="Spread" value={`${book.spread.toFixed(2)} (${book.spreadPercent.toFixed(3)}%)`} tone="sky" />}
          />

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <TerminalInset>
              <div className="flex flex-col gap-3 border-b border-terminal-border pb-4 md:flex-row md:items-center md:justify-between">
                <TerminalSegmentedTabs
                  activeId={viewMode}
                  onChange={(value) => setViewMode(value as ViewMode)}
                  options={[
                    { id: 'both', label: 'Both', meta: 'full depth' },
                    { id: 'bids', label: 'Bids', meta: 'buy wall' },
                    { id: 'asks', label: 'Asks', meta: 'sell wall' },
                  ]}
                />
                <div className="flex flex-wrap items-center gap-2">
                  {[0.01, 0.1, 1].map((step) => (
                    <TerminalSelectPill
                      key={step}
                      label={String(step)}
                      detail="tick"
                      active={precision === step}
                      onClick={() => setPrecision(step as PrecisionStep)}
                    />
                  ))}
                  <TerminalIconButton label="Depth settings">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
                    </svg>
                  </TerminalIconButton>
                </div>
              </div>

              <div className="mt-4 grid gap-1 font-mono text-[11px]">
                <div className="grid grid-cols-3 gap-3 px-3 text-[10px] uppercase tracking-[0.14em] text-terminal-text-muted">
                  <span>Price</span>
                  <span className="text-right">Size</span>
                  <span className="text-right">Total</span>
                </div>

                {showAsks ? (
                  <div className="grid gap-1">
                    {[...book.asks].reverse().map((level) => (
                      <TerminalOrderBookDepthRow
                        key={`ask-${level.price}`}
                        level={level}
                        side="ask"
                        maxTotal={book.maxTotal}
                        precision={precision}
                      />
                    ))}
                  </div>
                ) : null}

                <div className="my-1 rounded-suwappu-xxl border border-terminal-border-active bg-white px-3 py-2 shadow-suwappu-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm font-semibold text-terminal-text">
                      {book.midPrice.toFixed(Math.max(2, -Math.log10(precision)))}
                    </span>
                    <span className="text-xs text-terminal-text-secondary">
                      Spread {book.spread.toFixed(2)} / {book.spreadPercent.toFixed(3)}%
                    </span>
                  </div>
                </div>

                {showBids ? (
                  <div className="grid gap-1">
                    {book.bids.map((level) => (
                      <TerminalOrderBookDepthRow
                        key={`bid-${level.price}`}
                        level={level}
                        side="bid"
                        maxTotal={book.maxTotal}
                        precision={precision}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </TerminalInset>

            <div className="grid gap-4">
              <TimeAndSales />
              <TerminalMetricCard
                label="What changed"
                value="row primitive + spread card"
                detail="The live panel currently mixes controls, headers, spread, and rows in one component."
              />
              <TerminalMetricCard
                label="What becomes reusable"
                value="depth rows and table framing"
                detail="These can be reused for ladders, liquidity views, and historical market tapes."
                tone="warm"
              />
              <TerminalMetricCard
                label="Next slice"
                value="token detail inspector"
                detail="After market depth, the right next move is the token detail panel using the same data-display primitives."
                tone="sky"
              />
            </div>
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Workbench/Order Book Rebuild Lab',
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <OrderBookLab />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}
