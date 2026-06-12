import type { Meta, StoryObj } from '@storybook/react'
import { TokenBalance } from '../components/TokenBalance'
import { mockTokens, mockPortfolio } from './mockData'

// Since Portfolio uses hooks, we create a presentational version for stories
function PortfolioPresentation({
  totalValue,
  tokens,
  isLoading,
  isError,
}: {
  totalValue: number
  tokens: typeof mockTokens
  isLoading?: boolean
  isError?: boolean
}) {
  if (isLoading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-tg-secondary rounded-xl" />
          <div className="h-16 bg-tg-secondary rounded-xl" />
          <div className="h-16 bg-tg-secondary rounded-xl" />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-500 mb-4">Failed to load portfolio</p>
        <button className="px-4 py-2 bg-tg-button text-tg-button-text rounded-lg">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Total Value Card */}
      <div className="bg-tg-secondary rounded-xl p-4">
        <p className="text-tg-hint text-sm">Total Balance</p>
        <p className="text-3xl font-bold text-tg-text mt-1">
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>

      {/* Tokens List */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-tg-text">Assets</h2>
          <button className="text-tg-link text-sm">
            Refresh
          </button>
        </div>

        {tokens.length === 0 ? (
          <div className="text-center py-8 text-tg-hint">
            <p>No assets found</p>
            <p className="text-sm mt-1">Start by making a swap!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tokens.map((token) => (
              <TokenBalance key={`${token.chain}-${token.address}`} token={token} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const meta = {
  title: 'Pages/Portfolio',
  component: PortfolioPresentation,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PortfolioPresentation>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    totalValue: mockPortfolio.totalUsdValue,
    tokens: mockTokens,
  },
}

export const Loading: Story = {
  args: {
    totalValue: 0,
    tokens: [],
    isLoading: true,
  },
}

export const Error: Story = {
  args: {
    totalValue: 0,
    tokens: [],
    isError: true,
  },
}

export const Empty: Story = {
  args: {
    totalValue: 0,
    tokens: [],
  },
}

export const SingleToken: Story = {
  args: {
    totalValue: mockTokens[0].usdValue,
    tokens: [mockTokens[0]],
  },
}

export const LargePortfolio: Story = {
  args: {
    totalValue: 1250000.00,
    tokens: [
      ...mockTokens,
      {
        symbol: 'WBTC',
        name: 'Wrapped Bitcoin',
        address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        chain: 'ethereum',
        balance: '5.5',
        usdValue: 467500.00,
      },
      {
        symbol: 'LINK',
        name: 'Chainlink',
        address: '0x514910771af9ca656af840dff83e8264ecf986ca',
        chain: 'ethereum',
        balance: '1000',
        usdValue: 14500.00,
      },
    ],
  },
}
