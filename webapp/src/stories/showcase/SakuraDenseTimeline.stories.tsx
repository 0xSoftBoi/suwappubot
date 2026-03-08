import type { Meta, StoryObj } from '@storybook/react'
import { SakuraDenseTimeline } from '../../components/showcase/SakuraDenseTimeline'
import type { DenseTimelineItem } from '../../components/showcase/SakuraDenseTimeline'

const sampleItems: DenseTimelineItem[] = [
  {
    id: '1',
    type: 'swap',
    title: 'ETH → USDC',
    amount: '0.5 ETH',
    timestamp: '2m ago',
    status: 'completed',
    fromChain: 'ethereum',
    chainColor: '#627EEA',
  },
  {
    id: '2',
    type: 'bridge',
    title: 'USDC → Base',
    amount: '890 USDC',
    timestamp: '5m ago',
    status: 'pending',
    fromChain: 'ethereum',
    toChain: 'base',
    chainColor: '#627EEA',
    toChainColor: '#0052FF',
  },
  {
    id: '3',
    type: 'receive',
    title: 'Received SOL',
    amount: '5.0 SOL',
    timestamp: '12m ago',
    status: 'completed',
    fromChain: 'solana',
    chainColor: '#9945FF',
  },
  {
    id: '4',
    type: 'approve',
    title: 'Approve USDC',
    amount: 'Unlimited',
    timestamp: '15m ago',
    status: 'completed',
    fromChain: 'base',
    chainColor: '#0052FF',
  },
  {
    id: '5',
    type: 'swap',
    title: 'BNB → MATIC',
    amount: '1.0 BNB',
    timestamp: '2h ago',
    status: 'failed',
    fromChain: 'bsc',
    toChain: 'polygon',
    chainColor: '#F0B90B',
    toChainColor: '#8247E5',
  },
  {
    id: '6',
    type: 'send',
    title: 'Send ETH',
    amount: '0.1 ETH',
    timestamp: '3h ago',
    status: 'completed',
    fromChain: 'arbitrum',
    chainColor: '#28A0F0',
  },
  {
    id: '7',
    type: 'stake',
    title: 'Stake ETH',
    amount: '1.0 ETH',
    timestamp: '5h ago',
    status: 'completed',
    fromChain: 'ethereum',
    chainColor: '#627EEA',
  },
  {
    id: '8',
    type: 'swap',
    title: 'SOL → USDC',
    amount: '2.5 SOL',
    timestamp: '1d ago',
    status: 'completed',
    fromChain: 'solana',
    chainColor: '#9945FF',
  },
]

const meta = {
  title: 'Showcase/SakuraDenseTimeline',
  component: SakuraDenseTimeline,
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'suwappu', values: [{ name: 'suwappu', value: '#FFFBFC' }] },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SakuraDenseTimeline>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    items: sampleItems,
    title: 'Transaction Feed',
    subtitle: 'All activity',
  },
}

export const PendingOnly: Story = {
  args: {
    items: sampleItems.filter((i) => i.status === 'pending'),
    title: 'Pending',
    subtitle: 'In progress',
  },
}

export const MixedStatuses: Story = {
  args: {
    items: sampleItems.slice(0, 5),
    title: 'Recent Activity',
  },
}

export const AllTypes: Story = {
  args: {
    items: sampleItems,
    title: 'All Transaction Types',
    subtitle: 'Swap · Bridge · Send · Receive · Approve · Stake',
  },
}
