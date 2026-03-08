import type { Meta, StoryObj } from '@storybook/react'
import { TokenPair } from '../../components/swap/TokenPair'

const ETH = { symbol: 'ETH', name: 'Ethereum', logoUrl: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' }
const USDC = { symbol: 'USDC', name: 'USD Coin', logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' }
const SOL = { symbol: 'SOL', name: 'Solana', logoUrl: 'https://assets.coingecko.com/coins/images/4128/small/solana.png' }
const meta = {
  title: 'Swap/TokenPair',
  component: TokenPair,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'radio',
      options: ['sm', 'md', 'lg'],
    },
    showArrow: { control: 'boolean' },
    showNames: { control: 'boolean' },
  },
} satisfies Meta<typeof TokenPair>

export default meta
type Story = StoryObj<typeof meta>

export const SameChain: Story = {
  args: {
    fromToken: ETH,
    toToken: USDC,
    fromChain: 'ethereum',
    toChain: 'ethereum',
    size: 'md',
  },
}

export const CrossChain: Story = {
  args: {
    fromToken: USDC,
    toToken: USDC,
    fromChain: 'polygon',
    toChain: 'arbitrum',
    size: 'md',
  },
}

export const AllSizes: Story = {
  args: {} as any,
  render: () => (
    <div className="flex items-center gap-8">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <TokenPair
            fromToken={ETH}
            toToken={USDC}
            fromChain="ethereum"
            toChain="ethereum"
            size={size}
          />
          <span className="text-xs text-suwappu-text-secondary">{size}</span>
        </div>
      ))}
    </div>
  ),
}

export const WithNames: Story = {
  args: {
    fromToken: ETH,
    toToken: USDC,
    fromChain: 'ethereum',
    toChain: 'arbitrum',
    showNames: true,
    size: 'lg',
  },
}

export const NoLogos: Story = {
  args: {
    fromToken: { symbol: 'PEPE', name: 'Pepe' },
    toToken: { symbol: 'SHIB', name: 'Shiba Inu' },
    size: 'md',
  },
}

export const NoArrow: Story = {
  args: {
    fromToken: ETH,
    toToken: USDC,
    showArrow: false,
    size: 'md',
  },
}

export const SolanaToEvm: Story = {
  args: {
    fromToken: SOL,
    toToken: ETH,
    fromChain: 'solana',
    toChain: 'ethereum',
    size: 'lg',
    showNames: true,
  },
}
