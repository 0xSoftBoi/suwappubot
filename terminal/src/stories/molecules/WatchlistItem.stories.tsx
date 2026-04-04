import type { Meta, StoryObj } from '@storybook/react-vite'
import { WatchlistItem } from '../../components/watchlist/WatchlistItem'
import type { WatchlistToken } from '../../hooks/useWatchlist'
import type { TokenPriceData } from '../../hooks/useWatchlistPrices'

const token: WatchlistToken = {
  symbol: 'SOL',
  name: 'Solana',
  address: 'So11111111111111111111111111111111111111112',
  chain: 'solana',
}

function SummerBreezeWatchlistBoard() {
  const rows: Array<{
    token: WatchlistToken
    priceData: TokenPriceData
  }> = [
    {
      token,
      priceData: {
        price: 182.34,
        change24h: 6.42,
        loading: false,
      },
    },
    {
      token: {
        symbol: 'ETH',
        name: 'Ethereum',
        address: '0x0000000000000000000000000000000000000001',
        chain: 'ethereum',
      },
      priceData: {
        price: 3488.11,
        change24h: -2.18,
        loading: false,
      },
    },
    {
      token: {
        symbol: 'JUP',
        name: 'Jupiter',
        address: 'JUP111111111111111111111111111111111111111',
        chain: 'solana',
      },
      priceData: {
        price: null,
        change24h: null,
        loading: true,
      },
    },
  ]

  return (
    <div className="relative overflow-hidden rounded-[36px] border border-[#E8DEC9] bg-[#FFFDF8] p-6 shadow-[0_24px_80px_rgba(67,43,28,0.08)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_12%,rgba(244,218,162,0.28),transparent_22%),radial-gradient(circle_at_92%_18%,rgba(255,195,140,0.16),transparent_20%),linear-gradient(180deg,#FFFDFB_0%,#FFF8EE_100%)]" />
      <div className="relative mb-5 max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.36em] text-[#AE9161]">Summer breeze molecule</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#2D211A]">
          Watchlist rows with airy spacing and calm contrast
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#7A6653]">
          A small rail for positive, negative, and loading states on a bright white canvas.
        </p>
      </div>
      <div className="relative grid gap-2 rounded-[28px] border border-[#E7DCC8] bg-white/96 p-3 shadow-[0_10px_30px_rgba(67,43,28,0.05)]">
        {rows.map((row) => (
          <div
            key={row.token.address}
            className="rounded-2xl border border-[#F0E3D0] bg-[#FFFDFB] px-1"
          >
            <WatchlistItem
              token={row.token}
              priceData={row.priceData}
              onRemove={() => undefined}
              onClick={() => undefined}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

const meta = {
  title: 'Molecules/Watchlist Item',
  component: WatchlistItem,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  args: {
    token,
    priceData: {
      price: 182.34,
      change24h: 6.42,
      loading: false,
    } satisfies TokenPriceData,
    onRemove: () => undefined,
    onClick: () => undefined,
  },
} satisfies Meta<typeof WatchlistItem>

export default meta

type Story = StoryObj<typeof meta>

export const Positive: Story = {}

export const Negative: Story = {
  args: {
    priceData: {
      price: 176.08,
      change24h: -4.18,
      loading: false,
    } satisfies TokenPriceData,
  },
}

export const Loading: Story = {
  args: {
    priceData: {
      price: null,
      change24h: null,
      loading: true,
    } satisfies TokenPriceData,
  },
}

export const SummerBreeze: Story = {
  render: () => <SummerBreezeWatchlistBoard />,
}
