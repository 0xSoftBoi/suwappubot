import type { Meta, StoryObj } from '@storybook/react'
import { SakuraActivityTimeline } from '../../components/showcase/SakuraActivityTimeline'
import type { TimelineEvent } from '../../components/showcase/SakuraActivityTimeline'

const sampleEvents: TimelineEvent[] = [
  {
    id: '1',
    title: 'Swap ETH → USDC',
    description: 'Swapped 0.5 ETH for 890 USDC on Ethereum mainnet via CoW Protocol.',
    timestamp: '2 min ago',
    status: 'completed',
    icon: '⇄',
    detail: '0.5 ETH → 890 USDC',
    chain: 'Ethereum',
    chainColor: '#627EEA',
  },
  {
    id: '2',
    title: 'Bridge to Base',
    description: 'Bridging 500 USDC from Ethereum to Base via Across.',
    timestamp: '5 min ago',
    status: 'active',
    icon: '🌉',
    detail: 'ETA: ~2 min remaining',
    chain: 'Base',
    chainColor: '#0052FF',
  },
  {
    id: '3',
    title: 'Approve USDC',
    description: 'Token approval for USDC spending on Base network.',
    timestamp: '8 min ago',
    status: 'completed',
    icon: '✓',
    chain: 'Base',
    chainColor: '#0052FF',
  },
  {
    id: '4',
    title: 'Swap SOL → USDC',
    description: 'Swapped 2.5 SOL for 375 USDC on Solana via Jupiter.',
    timestamp: '1 hour ago',
    status: 'completed',
    icon: '⇄',
    detail: '2.5 SOL → 375.25 USDC',
    chain: 'Solana',
    chainColor: '#9945FF',
  },
  {
    id: '5',
    title: 'Bridge Failed',
    description: 'BNB → MATIC bridge failed due to slippage tolerance exceeded.',
    timestamp: '2 hours ago',
    status: 'failed',
    icon: '⚠️',
    detail: 'Slippage exceeded',
    chain: 'BSC',
    chainColor: '#F0B90B',
  },
  {
    id: '6',
    title: 'Limit Order Set',
    description: 'Buy 1 ETH at $1,650. Waiting for price target.',
    timestamp: '3 hours ago',
    status: 'pending',
    icon: '📊',
    detail: 'Target: $1,650',
    chain: 'Ethereum',
    chainColor: '#627EEA',
  },
]

const meta = {
  title: 'Showcase/SakuraActivityTimeline',
  component: SakuraActivityTimeline,
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'suwappu', values: [{ name: 'suwappu', value: '#FFFBFC' }] },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SakuraActivityTimeline>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    events: sampleEvents,
    title: 'Activity',
    subtitle: 'Recent transactions',
  },
}

export const AllCompleted: Story = {
  args: {
    events: sampleEvents.map((e) => ({ ...e, status: 'completed' as const })),
    title: 'Completed Transactions',
  },
}

export const FewEvents: Story = {
  args: {
    events: sampleEvents.slice(0, 3),
    title: 'Quick View',
    subtitle: 'Latest',
  },
}
