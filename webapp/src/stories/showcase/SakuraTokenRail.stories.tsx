import type { Meta, StoryObj } from '@storybook/react'
import { SakuraTokenRail } from '../../components/showcase/SakuraTokenRail'
import type { TokenRailItem } from '../../components/showcase/SakuraTokenRail'

function sparkline(trend: 'up' | 'down' | 'volatile'): number[] {
  const base = 100
  const pts: number[] = []
  for (let i = 0; i < 24; i++) {
    const noise = (Math.sin(i * 1.3) + Math.cos(i * 0.7)) * 5
    if (trend === 'up') pts.push(base + i * 2 + noise)
    else if (trend === 'down') pts.push(base + 50 - i * 2 + noise)
    else pts.push(base + Math.sin(i * 0.8) * 15 + noise)
  }
  return pts
}

const sampleTokens: TokenRailItem[] = [
  {
    id: 'eth',
    symbol: 'ETH',
    name: 'Ethereum',
    chain: 'ethereum',
    chainColor: '#627EEA',
    price: '$1,782.45',
    change24h: 3.2,
    sparklineData: sparkline('up'),
    icon: 'Ξ',
    balance: '2.543 ETH',
  },
  {
    id: 'usdc',
    symbol: 'USDC',
    name: 'USD Coin',
    chain: 'ethereum',
    chainColor: '#627EEA',
    price: '$1.00',
    change24h: 0.01,
    sparklineData: sparkline('volatile'),
    icon: '💲',
    balance: '1,250.00',
  },
  {
    id: 'sol',
    symbol: 'SOL',
    name: 'Solana',
    chain: 'solana',
    chainColor: '#9945FF',
    price: '$150.30',
    change24h: -2.1,
    sparklineData: sparkline('down'),
    icon: '◎',
    balance: '10.5 SOL',
  },
  {
    id: 'base-eth',
    symbol: 'ETH',
    name: 'Ethereum (Base)',
    chain: 'base',
    chainColor: '#0052FF',
    price: '$1,782.45',
    change24h: 3.2,
    sparklineData: sparkline('up'),
    icon: 'Ξ',
    balance: '0.85 ETH',
  },
  {
    id: 'matic',
    symbol: 'MATIC',
    name: 'Polygon',
    chain: 'polygon',
    chainColor: '#8247E5',
    price: '$0.85',
    change24h: -0.8,
    sparklineData: sparkline('volatile'),
    icon: '⬡',
  },
  {
    id: 'bnb',
    symbol: 'BNB',
    name: 'BNB',
    chain: 'bsc',
    chainColor: '#F0B90B',
    price: '$300.12',
    change24h: 1.5,
    sparklineData: sparkline('up'),
    icon: '🔶',
    balance: '3.25 BNB',
  },
  {
    id: 'arb',
    symbol: 'ARB',
    name: 'Arbitrum',
    chain: 'arbitrum',
    chainColor: '#28A0F0',
    price: '$0.82',
    change24h: -4.3,
    sparklineData: sparkline('down'),
    icon: '🔷',
  },
]

const meta = {
  title: 'Showcase/SakuraTokenRail',
  component: SakuraTokenRail,
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'suwappu', values: [{ name: 'suwappu', value: '#FFFBFC' }] },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SakuraTokenRail>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    tokens: sampleTokens,
    title: 'Your Tokens',
    subtitle: 'Portfolio',
  },
}

export const WithoutBalances: Story = {
  args: {
    tokens: sampleTokens.map(({ balance, ...t }) => t),
    title: 'Market Overview',
  },
}

export const ThreeTokens: Story = {
  args: {
    tokens: sampleTokens.slice(0, 3),
    title: 'Top Movers',
    subtitle: '24H',
  },
}
