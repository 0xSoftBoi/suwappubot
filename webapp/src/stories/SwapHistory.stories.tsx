import type { Meta, StoryObj } from '@storybook/react'
import { SwapCard } from '../components/SwapCard'
import { mockSwaps } from './mockData'
import type { Swap } from '@suwappu/shared'

// Presentational version for Storybook
function SwapHistoryPresentation({
  swaps,
  isLoading,
  isError,
}: {
  swaps: Swap[]
  isLoading?: boolean
  isError?: boolean
}) {
  if (isLoading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-tg-secondary rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-500 mb-4">Failed to load swap history</p>
        <button className="px-4 py-2 bg-tg-button text-tg-button-text rounded-lg">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-tg-text">Recent Swaps</h2>
        <button className="text-tg-link text-sm">
          Refresh
        </button>
      </div>

      {swaps.length === 0 ? (
        <div className="text-center py-8 text-tg-hint">
          <p>No swaps yet</p>
          <p className="text-sm mt-1">Your swap history will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {swaps.map((swap) => (
            <SwapCard key={swap.id} swap={swap} />
          ))}
        </div>
      )}
    </div>
  )
}

const meta = {
  title: 'Pages/SwapHistory',
  component: SwapHistoryPresentation,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SwapHistoryPresentation>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    swaps: mockSwaps,
  },
}

export const Loading: Story = {
  args: {
    swaps: [],
    isLoading: true,
  },
}

export const Error: Story = {
  args: {
    swaps: [],
    isError: true,
  },
}

export const Empty: Story = {
  args: {
    swaps: [],
  },
}

export const SingleSwap: Story = {
  args: {
    swaps: [mockSwaps[0]],
  },
}

export const AllPending: Story = {
  args: {
    swaps: [
      { ...mockSwaps[1], id: '1' },
      { ...mockSwaps[1], id: '2', fromToken: 'ETH', toToken: 'USDC' },
      { ...mockSwaps[1], id: '3', fromChain: 'arbitrum', toChain: 'base' },
    ],
  },
}

export const MixedStatuses: Story = {
  args: {
    swaps: mockSwaps,
  },
}
