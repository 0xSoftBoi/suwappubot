import type { Meta, StoryObj } from '@storybook/react'
import { ChainBadge } from '../../components/swap/ChainBadge'

const ALL_CHAINS = [
  'ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism',
  'base', 'avalanche', 'fantom', 'linea', 'mantle',
  'gnosis', 'scroll', 'solana', 'sui', 'ton',
]

const meta = {
  title: 'Swap/ChainBadge',
  component: ChainBadge,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    chainId: {
      control: 'select',
      options: ALL_CHAINS,
    },
    size: {
      control: 'radio',
      options: ['sm', 'md', 'lg'],
    },
    showLabel: {
      control: 'boolean',
    },
  },
} satisfies Meta<typeof ChainBadge>

export default meta
type Story = StoryObj<typeof meta>

export const AllChains: Story = {
  args: {} as any,
  render: () => (
    <div className="grid grid-cols-5 gap-4">
      {ALL_CHAINS.map((chain) => (
        <div key={chain} className="flex flex-col items-center gap-1">
          <ChainBadge chainId={chain} size="md" />
          <span className="text-xs text-suwappu-text-secondary">{chain}</span>
        </div>
      ))}
    </div>
  ),
}

export const Sizes: Story = {
  args: {} as any,
  render: () => (
    <div className="flex items-center gap-6">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-1">
          <ChainBadge chainId="ethereum" size={size} />
          <span className="text-xs text-suwappu-text-secondary">{size}</span>
        </div>
      ))}
    </div>
  ),
}

export const WithLabel: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-2">
      {ALL_CHAINS.map((chain) => (
        <ChainBadge key={chain} chainId={chain} size="md" showLabel />
      ))}
    </div>
  ),
}

export const AsOverlay: Story = {
  args: {} as any,
  render: () => (
    <div className="flex items-center gap-6">
      {['ethereum', 'solana', 'polygon', 'bsc'].map((chain) => (
        <div key={chain} className="relative inline-block">
          <div className="w-10 h-10 rounded-full bg-suwappu-sakura-200 flex items-center justify-center text-sm font-bold text-suwappu-text">
            TK
          </div>
          <span className="absolute -bottom-0.5 -right-0.5">
            <ChainBadge chainId={chain} size="sm" />
          </span>
        </div>
      ))}
    </div>
  ),
}

export const DarkMode: Story = {
  args: {} as any,
  render: () => (
    <div className="dark bg-gray-900 p-6 rounded-lg">
      <div className="grid grid-cols-5 gap-4">
        {ALL_CHAINS.map((chain) => (
          <div key={chain} className="flex flex-col items-center gap-1">
            <ChainBadge chainId={chain} size="md" />
            <span className="text-xs text-gray-400">{chain}</span>
          </div>
        ))}
      </div>
    </div>
  ),
}
