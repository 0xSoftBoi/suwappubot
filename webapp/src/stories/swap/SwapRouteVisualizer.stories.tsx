import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { SwapRouteVisualizer, type RouteHop } from '../../components/swap/SwapRouteVisualizer'

// ── Mock data ──────────────────────────────────

const sameChainSimple: RouteHop[] = [
  {
    fromToken: 'ETH',
    toToken: 'USDC',
    fromChain: 'ethereum',
    toChain: 'ethereum',
    provider: 'cow',
    type: 'swap',
    fee: 0,
    estimatedTime: '~15s',
    poolInfo: 'P2P batch',
  },
]

const sameChainMultiHop: RouteHop[] = [
  {
    fromToken: 'ETH',
    toToken: 'WETH',
    fromChain: 'ethereum',
    toChain: 'ethereum',
    provider: 'cow',
    type: 'swap',
    fee: 0,
    estimatedTime: '~5s',
  },
  {
    fromToken: 'WETH',
    toToken: 'USDC',
    fromChain: 'ethereum',
    toChain: 'ethereum',
    provider: 'socket',
    type: 'swap',
    fee: 0.5,
    estimatedTime: '~10s',
    poolInfo: 'Uniswap V3 0.3%',
  },
]

const crossChainBridge: RouteHop[] = [
  {
    fromToken: 'USDC',
    toToken: 'USDC',
    fromChain: 'polygon',
    toChain: 'arbitrum',
    provider: 'cctp',
    type: 'bridge',
    fee: 0,
    estimatedTime: '~2min',
  },
]

const crossChainFull: RouteHop[] = [
  {
    fromToken: 'ETH',
    toToken: 'WETH',
    fromChain: 'ethereum',
    toChain: 'ethereum',
    provider: 'cow',
    type: 'swap',
    fee: 0,
    estimatedTime: '~5s',
  },
  {
    fromToken: 'WETH',
    toToken: 'WETH',
    fromChain: 'ethereum',
    toChain: 'arbitrum',
    provider: 'across',
    type: 'bridge',
    fee: 1.23,
    estimatedTime: '~2min',
  },
  {
    fromToken: 'WETH',
    toToken: 'ARB',
    fromChain: 'arbitrum',
    toChain: 'arbitrum',
    provider: 'socket',
    type: 'swap',
    fee: 0.12,
    estimatedTime: '~5s',
    poolInfo: 'Camelot V3',
  },
]

const manyHops: RouteHop[] = [
  {
    fromToken: 'DAI',
    toToken: 'USDC',
    fromChain: 'ethereum',
    toChain: 'ethereum',
    provider: 'cow',
    type: 'swap',
    fee: 0,
    estimatedTime: '~5s',
    poolInfo: 'CoW batch',
  },
  {
    fromToken: 'USDC',
    toToken: 'USDC',
    fromChain: 'ethereum',
    toChain: 'polygon',
    provider: 'cctp',
    type: 'bridge',
    fee: 0,
    estimatedTime: '~2min',
  },
  {
    fromToken: 'USDC',
    toToken: 'WMATIC',
    fromChain: 'polygon',
    toChain: 'polygon',
    provider: 'socket',
    type: 'swap',
    fee: 0.08,
    estimatedTime: '~5s',
    poolInfo: 'QuickSwap V3',
  },
  {
    fromToken: 'WMATIC',
    toToken: 'WMATIC',
    fromChain: 'polygon',
    toChain: 'arbitrum',
    provider: 'across',
    type: 'bridge',
    fee: 0.45,
    estimatedTime: '~3min',
  },
  {
    fromToken: 'WMATIC',
    toToken: 'GMX',
    fromChain: 'arbitrum',
    toChain: 'arbitrum',
    provider: 'socket',
    type: 'swap',
    fee: 0.22,
    estimatedTime: '~5s',
    poolInfo: 'Camelot V3',
  },
]

// ── Meta ────────────────────────────────────────

const meta = {
  title: 'Swap/SwapRouteVisualizer',
  component: SwapRouteVisualizer,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    mode: {
      control: 'radio',
      options: ['compact', 'expanded'],
    },
  },
} satisfies Meta<typeof SwapRouteVisualizer>

export default meta
type Story = StoryObj<typeof meta>

// ── Helper wrapper for controlled toggle ────────

function ToggleWrapper({ hops, startMode = 'compact' }: { hops: RouteHop[]; startMode?: 'compact' | 'expanded' }) {
  const [mode, setMode] = useState<'compact' | 'expanded'>(startMode)
  return (
    <SwapRouteVisualizer
      hops={hops}
      mode={mode}
      onToggleMode={() => setMode((m) => (m === 'compact' ? 'expanded' : 'compact'))}
    />
  )
}

// ── Stories ──────────────────────────────────────

export const SameChainSimple_Compact: Story = {
  args: {
    hops: sameChainSimple,
    mode: 'compact',
  },
}

export const SameChainSimple_Expanded: Story = {
  args: {
    hops: sameChainSimple,
    mode: 'expanded',
  },
}

export const MultiHop_Compact: Story = {
  args: {
    hops: sameChainMultiHop,
    mode: 'compact',
  },
}

export const MultiHop_Expanded: Story = {
  args: {
    hops: sameChainMultiHop,
    mode: 'expanded',
  },
}

export const CrossChainBridge_Compact: Story = {
  args: {
    hops: crossChainBridge,
    mode: 'compact',
  },
}

export const CrossChainBridge_Expanded: Story = {
  args: {
    hops: crossChainBridge,
    mode: 'expanded',
  },
}

export const FullCrossChain_Compact: Story = {
  args: {
    hops: crossChainFull,
    mode: 'compact',
  },
}

export const FullCrossChain_Expanded: Story = {
  args: {
    hops: crossChainFull,
    mode: 'expanded',
  },
}

export const ManyHops: Story = {
  name: 'ManyHops (5 hops, toggle)',
  args: {} as any,
  render: () => <ToggleWrapper hops={manyHops} startMode="expanded" />,
}

export const MobileViewport: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-[360px] border border-gray-200 rounded-suwappu-md p-4">
      <p className="text-xs text-suwappu-text-secondary mb-3">360px viewport</p>
      <ToggleWrapper hops={crossChainFull} startMode="compact" />
    </div>
  ),
}
