import type { Meta, StoryObj } from '@storybook/react'
import { SwapCard } from '../components/SwapCard'
import { mockSwaps } from './mockData'

const meta = {
  title: 'Components/SwapCard',
  component: SwapCard,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    swap: {
      description: 'Swap transaction data',
    },
  },
} satisfies Meta<typeof SwapCard>

export default meta
type Story = StoryObj<typeof meta>

export const Completed: Story = {
  args: {
    swap: mockSwaps[0], // completed ETH -> ARB swap
  },
}

export const Pending: Story = {
  args: {
    swap: mockSwaps[1], // pending USDC bridge
  },
}

export const Failed: Story = {
  args: {
    swap: mockSwaps[2], // failed swap
  },
}

export const SolanaSwap: Story = {
  args: {
    swap: mockSwaps[3], // Solana swap
  },
}

export const Cancelled: Story = {
  args: {
    swap: mockSwaps[4], // cancelled swap
  },
}

export const CrossChain: Story = {
  args: {
    swap: {
      id: '6',
      fromChain: 'ethereum',
      toChain: 'solana',
      fromToken: 'USDC',
      toToken: 'USDC',
      fromAmount: '1000',
      toAmount: '998.50',
      status: 'completed',
      txHash: '0xethereumhash123456789',
      destinationTxHash: 'solanahash123456789',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
  },
}

export const NoTxHash: Story = {
  args: {
    swap: {
      id: '7',
      fromChain: 'polygon',
      toChain: 'arbitrum',
      fromToken: 'MATIC',
      toToken: 'ETH',
      fromAmount: '100',
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  },
}
