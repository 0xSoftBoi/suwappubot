import type { Meta, StoryObj } from '@storybook/react'
import { ProviderLogo, type SwapProvider } from '../../components/swap/ProviderLogo'

const meta = {
  title: 'Swap/ProviderLogo',
  component: ProviderLogo,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    provider: {
      control: 'select',
      options: ['cow', 'jupiter', 'socket', 'cctp', 'across', 'wormhole', 'lifi', 'layerzero', 'ccip'],
    },
    size: {
      control: 'radio',
      options: ['sm', 'md', 'lg'],
    },
    showName: {
      control: 'boolean',
    },
  },
} satisfies Meta<typeof ProviderLogo>

export default meta
type Story = StoryObj<typeof meta>

const ALL_PROVIDERS: SwapProvider[] = [
  'cow', 'jupiter', 'socket', 'cctp', 'across', 'wormhole', 'lifi', 'layerzero', 'ccip',
]

export const AllProviders: Story = {
  args: {} as any,
  render: () => (
    <div className="grid grid-cols-3 gap-4">
      {ALL_PROVIDERS.map((provider) => (
        <ProviderLogo key={provider} provider={provider} size="md" showName />
      ))}
    </div>
  ),
}

export const Sizes: Story = {
  args: {} as any,
  render: () => (
    <div className="flex items-center gap-6">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <ProviderLogo provider="cow" size={size} />
          <span className="text-xs text-gray-500">{size}</span>
        </div>
      ))}
    </div>
  ),
}

export const WithDescription: Story = {
  args: {} as any,
  render: () => (
    <div className="space-y-4">
      {ALL_PROVIDERS.map((provider) => (
        <div key={provider} className="flex items-start gap-3">
          <ProviderLogo provider={provider} size="lg" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-suwappu-text">
              {provider === 'cow' && 'CoW Protocol'}
              {provider === 'jupiter' && 'Jupiter'}
              {provider === 'socket' && 'Socket'}
              {provider === 'cctp' && 'Circle CCTP'}
              {provider === 'across' && 'Across'}
              {provider === 'wormhole' && 'Wormhole'}
              {provider === 'lifi' && 'Li.Fi'}
              {provider === 'layerzero' && 'LayerZero'}
              {provider === 'ccip' && 'Chainlink CCIP'}
            </span>
            <span className="text-xs text-suwappu-text-secondary">
              {provider === 'cow' && 'MEV-protected, batch auctions'}
              {provider === 'jupiter' && 'Solana DEX aggregator'}
              {provider === 'socket' && 'Cross-chain aggregator'}
              {provider === 'cctp' && 'Native USDC bridging'}
              {provider === 'across' && 'Fast EVM bridging'}
              {provider === 'wormhole' && 'Cross-chain messaging'}
              {provider === 'lifi' && 'Multi-bridge aggregator'}
              {provider === 'layerzero' && 'Omnichain protocol'}
              {provider === 'ccip' && 'Cross-chain interop'}
            </span>
          </div>
        </div>
      ))}
    </div>
  ),
}

export const UnknownProvider: Story = {
  args: {} as any,
  render: () => (
    <div className="flex items-center gap-4">
      <ProviderLogo provider="unknown-dex" size="md" showName />
      <ProviderLogo provider="mystery" size="lg" showName />
      <ProviderLogo provider="new-bridge" size="sm" />
    </div>
  ),
}

export const InlineUsage: Story = {
  args: {} as any,
  render: () => (
    <div className="flex items-center gap-1 rounded-suwappu-md bg-white p-3 shadow-suwappu-1">
      <ProviderLogo provider="cow" size="sm" />
      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <ProviderLogo provider="across" size="sm" />
      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <ProviderLogo provider="jupiter" size="sm" />
      <span className="ml-2 text-xs text-suwappu-text-secondary">3-hop route</span>
    </div>
  ),
}
