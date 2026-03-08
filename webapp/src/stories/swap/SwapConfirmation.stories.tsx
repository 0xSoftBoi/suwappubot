import type { Meta, StoryObj } from '@storybook/react'
import { SwapConfirmation } from '../../components/swap/SwapConfirmation'

const ETH = { symbol: 'ETH', name: 'Ethereum', logoUrl: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' }
const USDC = { symbol: 'USDC', name: 'USD Coin', logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' }
const MATIC = { symbol: 'MATIC', name: 'Polygon', logoUrl: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png' }
const ARB = { symbol: 'ARB', name: 'Arbitrum', logoUrl: 'https://assets.coingecko.com/coins/images/16547/small/arb.png' }

const meta = {
  title: 'Swap/SwapConfirmation',
  component: SwapConfirmation,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', minHeight: '100vh', background: '#f8f8f8' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SwapConfirmation>

export default meta
type Story = StoryObj<typeof meta>

const baseArgs = {
  isOpen: true,
  onConfirm: () => console.log('Confirmed!'),
  onCancel: () => console.log('Cancelled!'),
  fromToken: ETH,
  toToken: USDC,
  fromChain: 'ethereum',
  toChain: 'ethereum',
  fromAmount: 1.0,
  toAmount: 1245.67,
  fromAmountUsd: 1245.67,
  toAmountUsd: 1245.67,
  priceImpact: 0.12,
  networkFeeUsd: 2.34,
  route: 'ETH > WETH > USDC',
  provider: 'CoW',
  mevProtected: true,
  slippage: 0.5,
  minReceived: 1243.2,
  estimatedTime: '15s',
  quoteExpiresIn: 30,
}

export const StandardSwap: Story = {
  args: baseArgs,
}

export const CrossChainSwap: Story = {
  args: {
    ...baseArgs,
    fromToken: MATIC,
    toToken: ARB,
    fromChain: 'polygon',
    toChain: 'arbitrum',
    fromAmount: 500,
    toAmount: 245.3,
    fromAmountUsd: 340.0,
    toAmountUsd: 338.5,
    priceImpact: 0.44,
    route: 'MATIC > USDC > ARB',
    provider: 'Socket',
    estimatedTime: '2-5 min',
    networkFeeUsd: 1.56,
    minReceived: 243.8,
  },
}

export const HighImpact: Story = {
  args: {
    ...baseArgs,
    priceImpact: 3.5,
    toAmount: 1202.0,
    toAmountUsd: 1202.0,
    minReceived: 1196.0,
  },
}

export const LargeTrade: Story = {
  args: {
    ...baseArgs,
    fromAmount: 10.0,
    toAmount: 12456.7,
    fromAmountUsd: 12456.7,
    toAmountUsd: 12456.7,
    minReceived: 12394.0,
    isLargeTrade: true,
  },
}

export const MevProtected: Story = {
  args: {
    ...baseArgs,
    mevProtected: true,
  },
}

export const MevUnprotected: Story = {
  args: {
    ...baseArgs,
    mevProtected: false,
  },
}

export const QuoteExpiring: Story = {
  args: {
    ...baseArgs,
    quoteExpiresIn: 5,
  },
}

export const QuoteExpired: Story = {
  args: {
    ...baseArgs,
    quoteExpiresIn: 0,
  },
}

export const MultipleWarnings: Story = {
  args: {
    ...baseArgs,
    priceImpact: 4.2,
    isLargeTrade: true,
    fromChain: 'polygon',
    toChain: 'arbitrum',
    estimatedTime: '3 min',
    toAmount: 11980.0,
    toAmountUsd: 11980.0,
    fromAmount: 10.0,
    fromAmountUsd: 12456.7,
    minReceived: 11900.0,
  },
}

export const MobileViewport: Story = {
  args: baseArgs,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '360px', margin: '0 auto', position: 'relative', minHeight: '100vh', background: '#f8f8f8' }}>
        <Story />
      </div>
    ),
  ],
}
