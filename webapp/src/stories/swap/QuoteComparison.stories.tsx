import type { Meta, StoryObj } from '@storybook/react'
import { QuoteComparison, type SwapQuoteResult } from '../../components/swap/QuoteComparison'

const meta = {
  title: 'Swap/QuoteComparison',
  component: QuoteComparison,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    isLoading: { control: 'boolean' },
    fromTokenSymbol: { control: 'text' },
    toTokenSymbol: { control: 'text' },
  },
} satisfies Meta<typeof QuoteComparison>

export default meta
type Story = StoryObj<typeof meta>

const mockQuotes: SwapQuoteResult[] = [
  {
    id: '1',
    provider: 'cow',
    receiveAmount: 1245.67,
    receiveToken: 'USDC',
    rate: 1245.67,
    priceImpact: 0.12,
    gasCostUsd: 2.34,
    estimatedTime: '~15s',
    route: 'ETH > WETH > USDC (P2P)',
    badges: ['best-price'],
  },
  {
    id: '2',
    provider: 'socket',
    receiveAmount: 1243.5,
    receiveToken: 'USDC',
    rate: 1243.5,
    priceImpact: 0.15,
    gasCostUsd: 3.12,
    estimatedTime: '~20s',
    route: 'ETH > WETH > USDC (Uniswap V3)',
    badges: [],
  },
  {
    id: '3',
    provider: 'lifi',
    receiveAmount: 1242.1,
    receiveToken: 'USDC',
    rate: 1242.1,
    priceImpact: 0.18,
    gasCostUsd: 1.89,
    estimatedTime: '~25s',
    route: 'ETH > USDC (1inch)',
    badges: ['lowest-gas'],
  },
  {
    id: '4',
    provider: 'across',
    receiveAmount: 1240.0,
    receiveToken: 'USDC',
    rate: 1240.0,
    priceImpact: 0.25,
    gasCostUsd: 2.5,
    estimatedTime: '~5s',
    route: 'ETH > Bridge > USDC',
    bridgeFee: 1.23,
    badges: ['fastest'],
  },
  {
    id: '5',
    provider: 'cctp',
    receiveAmount: 1238.0,
    receiveToken: 'USDC',
    rate: 1238.0,
    priceImpact: 0.3,
    gasCostUsd: 4.0,
    estimatedTime: '~2min',
    route: 'USDC > CCTP > USDC',
    badges: [],
  },
]

export const FullResults: Story = {
  args: {
    quotes: mockQuotes,
    isLoading: false,
    selectedQuoteId: '1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

export const Loading: Story = {
  args: {
    quotes: [],
    isLoading: true,
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

export const SingleProvider: Story = {
  args: {
    quotes: [mockQuotes[0]],
    isLoading: false,
    selectedQuoteId: '1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

export const NoResults: Story = {
  args: {
    quotes: [],
    isLoading: false,
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'SOL',
    toTokenSymbol: 'DOGE',
  },
}

export const SelectedNonDefault: Story = {
  args: {
    quotes: mockQuotes,
    isLoading: false,
    selectedQuoteId: '3',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

export const WithBridgeFees: Story = {
  args: {
    quotes: [
      {
        id: 'b1',
        provider: 'across',
        receiveAmount: 998.5,
        receiveToken: 'USDC',
        rate: 998.5,
        priceImpact: 0.08,
        gasCostUsd: 1.8,
        estimatedTime: '~5s',
        route: 'USDC (Arbitrum) > Bridge > USDC (Ethereum)',
        bridgeFee: 0.85,
        badges: ['fastest'],
      },
      {
        id: 'b2',
        provider: 'cctp',
        receiveAmount: 999.1,
        receiveToken: 'USDC',
        rate: 999.1,
        priceImpact: 0.02,
        gasCostUsd: 3.5,
        estimatedTime: '~15min',
        route: 'USDC > CCTP > USDC',
        bridgeFee: 0.0,
        badges: ['best-price'],
      },
      {
        id: 'b3',
        provider: 'wormhole',
        receiveAmount: 996.2,
        receiveToken: 'USDC',
        rate: 996.2,
        priceImpact: 0.35,
        gasCostUsd: 2.9,
        estimatedTime: '~3min',
        route: 'USDC > Wormhole > USDC',
        bridgeFee: 2.1,
        badges: [],
      },
    ],
    isLoading: false,
    selectedQuoteId: 'b1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'USDC',
    toTokenSymbol: 'USDC',
  },
}

const manyProviderQuotes: SwapQuoteResult[] = [
  ...mockQuotes,
  {
    id: '6',
    provider: 'wormhole',
    receiveAmount: 1236.0,
    receiveToken: 'USDC',
    rate: 1236.0,
    priceImpact: 0.35,
    gasCostUsd: 3.5,
    estimatedTime: '~3min',
    route: 'ETH > Wormhole > USDC',
    bridgeFee: 1.5,
    badges: [],
  },
  {
    id: '7',
    provider: 'layerzero',
    receiveAmount: 1235.0,
    receiveToken: 'USDC',
    rate: 1235.0,
    priceImpact: 0.4,
    gasCostUsd: 2.8,
    estimatedTime: '~45s',
    route: 'ETH > LayerZero > USDC',
    badges: [],
  },
  {
    id: '8',
    provider: 'ccip',
    receiveAmount: 1233.0,
    receiveToken: 'USDC',
    rate: 1233.0,
    priceImpact: 0.5,
    gasCostUsd: 5.0,
    estimatedTime: '~5min',
    route: 'ETH > CCIP > USDC',
    badges: [],
  },
]

export const ManyProviders: Story = {
  args: {
    quotes: manyProviderQuotes,
    isLoading: false,
    selectedQuoteId: '1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

export const StaggeredLoading: Story = {
  args: {
    quotes: mockQuotes.slice(0, 2),
    isLoading: true,
    selectedQuoteId: '1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

export const AllBadges: Story = {
  args: {
    quotes: [
      {
        ...mockQuotes[0],
        badges: ['best-price', 'fastest', 'lowest-gas'] as const,
      },
      mockQuotes[1],
      mockQuotes[2],
    ],
    isLoading: false,
    selectedQuoteId: '1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

export const MobileViewport: Story = {
  render: (args) => (
    <div className="max-w-[360px] mx-auto">
      <QuoteComparison {...args} />
    </div>
  ),
  args: {
    quotes: mockQuotes.slice(0, 3),
    isLoading: false,
    selectedQuoteId: '1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

// ---------------------------------------------------------------------------
// Additional story variants
// ---------------------------------------------------------------------------

const gasWarQuotes: SwapQuoteResult[] = [
  {
    id: 'gw1',
    provider: 'cow',
    receiveAmount: 3412.5,
    receiveToken: 'USDC',
    rate: 3412.5,
    priceImpact: 0.09,
    gasCostUsd: 2.1,
    estimatedTime: '~20s',
    route: 'ETH > CoW P2P > USDC',
    badges: ['lowest-gas'],
  },
  {
    id: 'gw2',
    provider: 'socket',
    receiveAmount: 3418.0,
    receiveToken: 'USDC',
    rate: 3418.0,
    priceImpact: 0.11,
    gasCostUsd: 14.5,
    estimatedTime: '~15s',
    route: 'ETH > WETH > USDC (Uniswap V3)',
    badges: [],
  },
  {
    id: 'gw3',
    provider: 'lifi',
    receiveAmount: 3425.8,
    receiveToken: 'USDC',
    rate: 3425.8,
    priceImpact: 0.14,
    gasCostUsd: 45.0,
    estimatedTime: '~25s',
    route: 'ETH > WETH > USDT > USDC (multi-hop)',
    badges: ['best-price'],
  },
  {
    id: 'gw4',
    provider: 'across',
    receiveAmount: 3415.2,
    receiveToken: 'USDC',
    rate: 3415.2,
    priceImpact: 0.1,
    gasCostUsd: 8.7,
    estimatedTime: '~10s',
    route: 'ETH > Across > USDC',
    bridgeFee: 1.0,
    badges: [],
  },
  {
    id: 'gw5',
    provider: 'cctp',
    receiveAmount: 3410.0,
    receiveToken: 'USDC',
    rate: 3410.0,
    priceImpact: 0.06,
    gasCostUsd: 28.3,
    estimatedTime: '~2min',
    route: 'ETH > WETH > USDC > CCTP > USDC',
    badges: [],
  },
]

export const GasWarComparison: Story = {  args: {
    quotes: gasWarQuotes,
    isLoading: false,
    selectedQuoteId: 'gw1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

const slowVsFastQuotes: SwapQuoteResult[] = [
  {
    id: 'sf1',
    provider: 'across',
    receiveAmount: 2480.0,
    receiveToken: 'USDC',
    rate: 2480.0,
    priceImpact: 0.15,
    gasCostUsd: 6.5,
    estimatedTime: '~30s',
    route: 'ETH > Across Bridge > USDC (Arbitrum)',
    bridgeFee: 3.2,
    badges: ['fastest'],
  },
  {
    id: 'sf2',
    provider: 'lifi',
    receiveAmount: 2488.5,
    receiveToken: 'USDC',
    rate: 2488.5,
    priceImpact: 0.12,
    gasCostUsd: 4.1,
    estimatedTime: '~2min',
    route: 'ETH > LiFi Aggregated > USDC (Arbitrum)',
    bridgeFee: 1.8,
    badges: [],
  },
  {
    id: 'sf3',
    provider: 'cctp',
    receiveAmount: 2495.0,
    receiveToken: 'USDC',
    rate: 2495.0,
    priceImpact: 0.03,
    gasCostUsd: 3.2,
    estimatedTime: '~10min',
    route: 'ETH > WETH > USDC > CCTP > USDC (Arbitrum)',
    bridgeFee: 0.0,
    badges: ['best-price', 'lowest-gas'],
  },
]

export const SlowVsFast: Story = {  args: {
    quotes: slowVsFastQuotes,
    isLoading: false,
    selectedQuoteId: 'sf1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

const bridgeFeeQuotes: SwapQuoteResult[] = [
  {
    id: 'bf1',
    provider: 'cctp',
    receiveAmount: 4990.0,
    receiveToken: 'USDC',
    rate: 1.0,
    priceImpact: 0.01,
    gasCostUsd: 3.8,
    estimatedTime: '~15min',
    route: 'USDC (Ethereum) > CCTP > USDC (Optimism)',
    bridgeFee: 0.0,
    badges: ['lowest-gas'],
  },
  {
    id: 'bf2',
    provider: 'across',
    receiveAmount: 4985.5,
    receiveToken: 'USDC',
    rate: 0.997,
    priceImpact: 0.05,
    gasCostUsd: 2.1,
    estimatedTime: '~8s',
    route: 'USDC (Ethereum) > Across > USDC (Optimism)',
    bridgeFee: 3.5,
    badges: ['fastest'],
  },
  {
    id: 'bf3',
    provider: 'socket',
    receiveAmount: 4982.0,
    receiveToken: 'USDC',
    rate: 0.996,
    priceImpact: 0.08,
    gasCostUsd: 4.5,
    estimatedTime: '~45s',
    route: 'USDC (Ethereum) > Stargate > USDC (Optimism)',
    bridgeFee: 7.8,
    badges: [],
  },
  {
    id: 'bf4',
    provider: 'lifi',
    receiveAmount: 4978.0,
    receiveToken: 'USDC',
    rate: 0.995,
    priceImpact: 0.1,
    gasCostUsd: 5.2,
    estimatedTime: '~3min',
    route: 'USDC (Ethereum) > Hop > USDC (Optimism)',
    bridgeFee: 12.0,
    badges: [],
  },
  {
    id: 'bf5',
    provider: 'wormhole',
    receiveAmount: 4980.5,
    receiveToken: 'USDC',
    rate: 0.996,
    priceImpact: 0.07,
    gasCostUsd: 3.0,
    estimatedTime: '~5min',
    route: 'USDC (Ethereum) > Wormhole > USDC (Optimism)',
    bridgeFee: 5.5,
    badges: [],
  },
]

export const BridgeFeeBreakdown: Story = {  args: {
    quotes: bridgeFeeQuotes,
    isLoading: false,
    selectedQuoteId: 'bf1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'USDC',
    toTokenSymbol: 'USDC',
  },
}

const tinySwapQuotes: SwapQuoteResult[] = [
  {
    id: 'ts1',
    provider: 'cow',
    receiveAmount: 9.82,
    receiveToken: 'USDC',
    rate: 3420.0,
    priceImpact: 0.35,
    gasCostUsd: 12.5,
    estimatedTime: '~20s',
    route: 'ETH > CoW P2P > USDC',
    badges: [],
  },
  {
    id: 'ts2',
    provider: 'socket',
    receiveAmount: 9.75,
    receiveToken: 'USDC',
    rate: 3395.0,
    priceImpact: 0.42,
    gasCostUsd: 18.3,
    estimatedTime: '~15s',
    route: 'ETH > WETH > USDC (Uniswap V3)',
    badges: [],
  },
  {
    id: 'ts3',
    provider: 'lifi',
    receiveAmount: 9.88,
    receiveToken: 'USDC',
    rate: 3440.0,
    priceImpact: 0.28,
    gasCostUsd: 8.9,
    estimatedTime: '~25s',
    route: 'ETH > 1inch > USDC',
    badges: ['best-price', 'lowest-gas'],
  },
]

export const TinySwap: Story = {  args: {
    quotes: tinySwapQuotes,
    isLoading: false,
    selectedQuoteId: 'ts3',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

const whaleSwapQuotes: SwapQuoteResult[] = [
  {
    id: 'ws1',
    provider: 'cow',
    receiveAmount: 497250.0,
    receiveToken: 'USDC',
    rate: 3315.0,
    priceImpact: 0.55,
    gasCostUsd: 45.0,
    estimatedTime: '~30s',
    route: 'ETH > CoW Batch Auction > USDC',
    badges: ['best-price'],
  },
  {
    id: 'ws2',
    provider: 'socket',
    receiveAmount: 493800.0,
    receiveToken: 'USDC',
    rate: 3292.0,
    priceImpact: 1.58,
    gasCostUsd: 38.0,
    estimatedTime: '~20s',
    route: 'ETH > Uniswap V3 (multi-pool) > USDC',
    badges: [],
  },
  {
    id: 'ws3',
    provider: 'lifi',
    receiveAmount: 495100.0,
    receiveToken: 'USDC',
    rate: 3300.67,
    priceImpact: 1.2,
    gasCostUsd: 52.0,
    estimatedTime: '~25s',
    route: 'ETH > Split (Uni V3 60% + Curve 40%) > USDC',
    badges: [],
  },
  {
    id: 'ws4',
    provider: 'across',
    receiveAmount: 491500.0,
    receiveToken: 'USDC',
    rate: 3276.67,
    priceImpact: 2.1,
    gasCostUsd: 28.0,
    estimatedTime: '~15s',
    route: 'ETH > Across > USDC',
    bridgeFee: 125.0,
    badges: ['lowest-gas'],
  },
  {
    id: 'ws5',
    provider: 'cctp',
    receiveAmount: 489000.0,
    receiveToken: 'USDC',
    rate: 3260.0,
    priceImpact: 2.8,
    gasCostUsd: 65.0,
    estimatedTime: '~5min',
    route: 'ETH > WETH > USDC > CCTP',
    badges: [],
  },
]

export const WhaleSwap: Story = {  args: {
    quotes: whaleSwapQuotes,
    isLoading: false,
    selectedQuoteId: 'ws1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

const solanaQuotes: SwapQuoteResult[] = [
  {
    id: 'sol1',
    provider: 'jupiter',
    receiveAmount: 142.85,
    receiveToken: 'USDC',
    rate: 142.85,
    priceImpact: 0.04,
    gasCostUsd: 0.002,
    estimatedTime: '~0.4s',
    route: 'SOL > Jupiter V6 > USDC (Orca)',
    badges: ['best-price', 'fastest', 'lowest-gas'],
  },
  {
    id: 'sol2',
    provider: 'jupiter',
    receiveAmount: 142.6,
    receiveToken: 'USDC',
    rate: 142.6,
    priceImpact: 0.06,
    gasCostUsd: 0.025,
    estimatedTime: '~0.4s',
    route: 'SOL > Jupiter V6 > USDC (Raydium CLMM) + Jito MEV bundle',
    badges: [],
  },
  {
    id: 'sol3',
    provider: 'jupiter',
    receiveAmount: 142.3,
    receiveToken: 'USDC',
    rate: 142.3,
    priceImpact: 0.08,
    gasCostUsd: 0.003,
    estimatedTime: '~0.8s',
    route: 'SOL > Jupiter V6 > wSOL > USDC (Meteora DLMM)',
    badges: [],
  },
]

export const SolanaQuotes: Story = {  args: {
    quotes: solanaQuotes,
    isLoading: false,
    selectedQuoteId: 'sol1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'SOL',
    toTokenSymbol: 'USDC',
  },
}

const partialRefreshQuotes: SwapQuoteResult[] = [
  {
    id: 'rq1',
    provider: 'cow',
    receiveAmount: 1870.2,
    receiveToken: 'USDC',
    rate: 1870.2,
    priceImpact: 0.1,
    gasCostUsd: 2.5,
    estimatedTime: '~15s',
    route: 'ETH > CoW P2P > USDC',
    badges: ['best-price'],
  },
  {
    id: 'rq2',
    provider: 'lifi',
    receiveAmount: 1865.8,
    receiveToken: 'USDC',
    rate: 1865.8,
    priceImpact: 0.14,
    gasCostUsd: 3.1,
    estimatedTime: '~20s',
    route: 'ETH > 1inch > USDC',
    badges: [],
  },
]

export const RefreshingQuotes: Story = {  args: {
    quotes: partialRefreshQuotes,
    isLoading: true,
    selectedQuoteId: 'rq1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}

export const DarkModeQuotes: Story = {
  render: (args) => (
    <div className="dark bg-gray-900 p-6 rounded-xl min-h-[400px]">
      <QuoteComparison {...args} />
    </div>
  ),
  args: {
    quotes: [
      {
        id: 'dm1',
        provider: 'cow',
        receiveAmount: 3415.0,
        receiveToken: 'USDC',
        rate: 3415.0,
        priceImpact: 0.08,
        gasCostUsd: 2.3,
        estimatedTime: '~15s',
        route: 'ETH > CoW Batch > USDC',
        badges: ['best-price'],
      },
      {
        id: 'dm2',
        provider: 'socket',
        receiveAmount: 3410.5,
        receiveToken: 'USDC',
        rate: 3410.5,
        priceImpact: 0.12,
        gasCostUsd: 3.8,
        estimatedTime: '~20s',
        route: 'ETH > Uniswap V3 > USDC',
        badges: [],
      },
      {
        id: 'dm3',
        provider: 'jupiter',
        receiveAmount: 3408.0,
        receiveToken: 'USDC',
        rate: 3408.0,
        priceImpact: 0.15,
        gasCostUsd: 0.005,
        estimatedTime: '~0.4s',
        route: 'ETH > Wormhole > SOL > Jupiter > USDC',
        bridgeFee: 2.5,
        badges: ['lowest-gas', 'fastest'],
      },
    ],
    isLoading: false,
    selectedQuoteId: 'dm1',
    onSelect: (id: string) => console.log('Selected:', id),
    fromTokenSymbol: 'ETH',
    toTokenSymbol: 'USDC',
  },
}
