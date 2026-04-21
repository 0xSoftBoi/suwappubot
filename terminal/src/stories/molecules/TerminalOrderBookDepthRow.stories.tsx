import type { Meta, StoryObj } from '@storybook/react'
import { TerminalInset, TerminalPage, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../components/foundation/TerminalPrimitives'
import { TerminalOrderBookDepthRow } from '../../components/orderbook/TerminalOrderBookDepthRow'
import type { OrderBookLevel } from '../../hooks/useOrderBook'

const askLevel: OrderBookLevel = {
  price: 3245.51,
  size: 4.2841,
  total: 12.9184,
}

const bidLevel: OrderBookLevel = {
  price: 3245.49,
  size: 5.1023,
  total: 14.6011,
}

function Board() {
  return (
    <TerminalPage>
      <div className="mx-auto max-w-4xl">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">order book row</TerminalStatusPill>}
            title="Depth row language"
            description="The order book should be rebuilt from shared row primitives and spread containers rather than raw grid divs in the live panel."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <TerminalInset>
              <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-terminal-text-muted">
                Ask row
              </div>
              <TerminalOrderBookDepthRow
                level={askLevel}
                maxTotal={32}
                side="ask"
                precision={0.01}
              />
            </TerminalInset>
            <TerminalInset>
              <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-terminal-text-muted">
                Bid row
              </div>
              <TerminalOrderBookDepthRow
                level={bidLevel}
                maxTotal={32}
                side="bid"
                precision={0.01}
              />
            </TerminalInset>
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Molecules/Terminal Order Book Depth Row',
  component: TerminalOrderBookDepthRow,
  args: {
    level: bidLevel,
    maxTotal: 32,
    side: 'bid' as const,
    precision: 0.01,
  },
} satisfies Meta<typeof TerminalOrderBookDepthRow>

export default meta

type Story = StoryObj<typeof meta>

export const Bid: Story = {}

export const Ask: Story = {
  args: {
    level: askLevel,
    side: 'ask',
  },
}

export const BoardView: Story = {
  render: () => <Board />,
}
