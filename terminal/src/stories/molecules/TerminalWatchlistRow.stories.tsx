import type { Meta, StoryObj } from '@storybook/react'
import { TerminalWatchlistRow } from '../../components/watchlist/TerminalWatchlistRow'
import { TerminalInset, TerminalPage, TerminalPanel, TerminalPanelHeader, TerminalStatusPill } from '../../components/foundation/TerminalPrimitives'
import type { WatchlistToken } from '../../hooks/useWatchlist'
import type { TokenPriceData } from '../../hooks/useWatchlistPrices'

const rows: Array<{ token: WatchlistToken; priceData: TokenPriceData }> = [
  {
    token: {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      chain: 'ethereum',
    },
    priceData: { price: 3521.15, change24h: 3.42, loading: false },
  },
  {
    token: {
      symbol: 'SOL',
      name: 'Solana',
      address: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
    },
    priceData: { price: 181.82, change24h: -1.34, loading: false },
  },
  {
    token: {
      symbol: 'JUP',
      name: 'Jupiter',
      address: 'JUP111111111111111111111111111111111111111',
      chain: 'solana',
    },
    priceData: { price: null, change24h: null, loading: true },
  },
]

function Board() {
  return (
    <TerminalPage>
      <div className="mx-auto max-w-5xl">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">watchlist row</TerminalStatusPill>}
            title="Redesigned watchlist row"
            description="The watchlist should be built from shared surface, badge, and delta primitives instead of ad hoc hover rows."
          />
          <TerminalInset className="grid gap-3">
            {rows.map((row, index) => (
              <TerminalWatchlistRow
                key={row.token.address}
                token={row.token}
                priceData={row.priceData}
                selected={index === 0}
              />
            ))}
          </TerminalInset>
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Molecules/Terminal Watchlist Row',
  component: TerminalWatchlistRow,
  args: {
    token: rows[0].token,
    priceData: rows[0].priceData,
    selected: false,
  },
} satisfies Meta<typeof TerminalWatchlistRow>

export default meta

type Story = StoryObj<typeof meta>

export const Positive: Story = {}

export const Negative: Story = {
  args: {
    token: rows[1].token,
    priceData: rows[1].priceData,
  },
}

export const Loading: Story = {
  args: {
    token: rows[2].token,
    priceData: rows[2].priceData,
  },
}

export const BoardView: Story = {
  render: () => <Board />,
}
