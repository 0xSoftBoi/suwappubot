import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { SwapImpactGauge } from '../../components/swap/SwapImpactGauge'
import { AnimatedNumber } from '../../components/swap/AnimatedNumber'

const meta = {
  title: 'Swap/SwapImpactGauge',
  component: SwapImpactGauge,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    overallScore: { control: { type: 'number', min: 0, max: 100 } },
    priceImpact: { control: { type: 'number', step: 0.1 } },
    gasCostUsd: { control: { type: 'number', step: 0.5 } },
    slippageRisk: { control: 'select', options: ['low', 'medium', 'high'] },
    liquidityDepth: { control: 'select', options: ['deep', 'moderate', 'shallow'] },
    variant: { control: 'select', options: ['full', 'compact', 'mini'] },
  },
} satisfies Meta<typeof SwapImpactGauge>

export default meta
type Story = StoryObj<typeof meta>

export const ExcellentSwap: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm">
      <SwapImpactGauge
        overallScore={92}
        priceImpact={0.05}
        gasCostUsd={1.20}
        slippageRisk="low"
        liquidityDepth="deep"
      />
    </div>
  ),
}

export const GoodSwap: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm">
      <SwapImpactGauge
        overallScore={71}
        priceImpact={0.35}
        gasCostUsd={8.50}
        slippageRisk="low"
        liquidityDepth="moderate"
      />
    </div>
  ),
}

export const FairSwap: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm">
      <SwapImpactGauge
        overallScore={55}
        priceImpact={1.80}
        gasCostUsd={12.00}
        slippageRisk="medium"
        liquidityDepth="moderate"
      />
    </div>
  ),
}

export const PoorSwap: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm">
      <SwapImpactGauge
        overallScore={28}
        priceImpact={4.50}
        gasCostUsd={22.00}
        slippageRisk="high"
        liquidityDepth="shallow"
      />
    </div>
  ),
}

export const BadSwap: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm">
      <SwapImpactGauge
        overallScore={12}
        priceImpact={8.20}
        gasCostUsd={45.00}
        slippageRisk="high"
        liquidityDepth="shallow"
      />
    </div>
  ),
}

export const AllScoreRanges: Story = {
  args: {} as any,
  render: () => (
    <div className="grid grid-cols-2 gap-4 max-w-2xl">
      <SwapImpactGauge
        overallScore={92}
        priceImpact={0.05}
        gasCostUsd={1.20}
        slippageRisk="low"
        liquidityDepth="deep"
      />
      <SwapImpactGauge
        overallScore={71}
        priceImpact={0.35}
        gasCostUsd={8.50}
        slippageRisk="low"
        liquidityDepth="moderate"
      />
      <SwapImpactGauge
        overallScore={55}
        priceImpact={1.80}
        gasCostUsd={12.00}
        slippageRisk="medium"
        liquidityDepth="moderate"
      />
      <SwapImpactGauge
        overallScore={28}
        priceImpact={4.50}
        gasCostUsd={22.00}
        slippageRisk="high"
        liquidityDepth="shallow"
      />
      <SwapImpactGauge
        overallScore={12}
        priceImpact={8.20}
        gasCostUsd={45.00}
        slippageRisk="high"
        liquidityDepth="shallow"
        className="col-span-2 max-w-sm mx-auto"
      />
    </div>
  ),
}

export const CompactVariant: Story = {
  args: {} as any,
  render: () => (
    <div className="flex gap-4">
      <SwapImpactGauge
        overallScore={88}
        priceImpact={0.10}
        gasCostUsd={2.00}
        slippageRisk="low"
        liquidityDepth="deep"
        variant="compact"
      />
      <SwapImpactGauge
        overallScore={55}
        priceImpact={1.50}
        gasCostUsd={10.00}
        slippageRisk="medium"
        liquidityDepth="moderate"
        variant="compact"
      />
      <SwapImpactGauge
        overallScore={22}
        priceImpact={6.00}
        gasCostUsd={35.00}
        slippageRisk="high"
        liquidityDepth="shallow"
        variant="compact"
      />
    </div>
  ),
}

export const MiniVariant: Story = {
  args: {} as any,
  render: () => (
    <div className="flex items-center gap-3">
      <SwapImpactGauge
        overallScore={95}
        priceImpact={0.02}
        gasCostUsd={0.80}
        slippageRisk="low"
        liquidityDepth="deep"
        variant="mini"
      />
      <SwapImpactGauge
        overallScore={72}
        priceImpact={0.40}
        gasCostUsd={6.00}
        slippageRisk="low"
        liquidityDepth="moderate"
        variant="mini"
      />
      <SwapImpactGauge
        overallScore={48}
        priceImpact={2.50}
        gasCostUsd={15.00}
        slippageRisk="medium"
        liquidityDepth="moderate"
        variant="mini"
      />
      <SwapImpactGauge
        overallScore={25}
        priceImpact={5.00}
        gasCostUsd={28.00}
        slippageRisk="high"
        liquidityDepth="shallow"
        variant="mini"
      />
      <SwapImpactGauge
        overallScore={8}
        priceImpact={9.00}
        gasCostUsd={42.00}
        slippageRisk="high"
        liquidityDepth="shallow"
        variant="mini"
      />
    </div>
  ),
}

export const WithSavings: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm">
      <SwapImpactGauge
        overallScore={85}
        priceImpact={0.12}
        gasCostUsd={2.50}
        slippageRisk="low"
        liquidityDepth="deep"
        estimatedSavings={4.32}
      />
    </div>
  ),
}

export const WithComparison: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-4 max-w-sm">
      <div className="text-xs text-suwappu-text-secondary">Score improved from previous swap</div>
      <SwapImpactGauge
        overallScore={82}
        priceImpact={0.18}
        gasCostUsd={3.00}
        slippageRisk="low"
        liquidityDepth="deep"
        previousScore={65}
      />
      <div className="text-xs text-suwappu-text-secondary">Score declined from previous swap</div>
      <SwapImpactGauge
        overallScore={45}
        priceImpact={2.10}
        gasCostUsd={18.00}
        slippageRisk="medium"
        liquidityDepth="moderate"
        previousScore={78}
      />
    </div>
  ),
}

export const StablecoinSwap: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm">
      <div className="text-xs text-suwappu-text-secondary mb-2">USDC → USDT — Excellent conditions for this swap</div>
      <SwapImpactGauge
        overallScore={97}
        priceImpact={0.01}
        gasCostUsd={0.50}
        slippageRisk="low"
        liquidityDepth="deep"
      />
    </div>
  ),
}

export const MemeTokenSwap: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm">
      <div className="text-xs text-suwappu-text-secondary mb-2">ETH → PEPE — High volatility meme token</div>
      <SwapImpactGauge
        overallScore={35}
        priceImpact={3.5}
        gasCostUsd={12.00}
        slippageRisk="high"
        liquidityDepth="shallow"
      />
    </div>
  ),
}

export const CrossChainBridge: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm">
      <div className="text-xs text-suwappu-text-secondary mb-2">ETH (Ethereum) → ETH (Arbitrum) — Includes bridge fee</div>
      <SwapImpactGauge
        overallScore={62}
        priceImpact={0.8}
        gasCostUsd={8.00}
        slippageRisk="medium"
        liquidityDepth="moderate"
      />
    </div>
  ),
}

export const WhaleSwap: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm">
      <div className="text-xs font-medium text-impact-severe mb-2">Large swap detected — severe price impact warning</div>
      <SwapImpactGauge
        overallScore={22}
        priceImpact={6.0}
        gasCostUsd={25.00}
        slippageRisk="high"
        liquidityDepth="shallow"
      />
    </div>
  ),
}

export const GaugeAnimation: Story = {
  args: {} as any,
  render: () => {
    const [score, setScore] = useState(50)
    const [impact, setImpact] = useState(1.0)
    const [gas, setGas] = useState(5.0)
    const [slippage, setSlippage] = useState<'low' | 'medium' | 'high'>('medium')
    const [liquidity, setLiquidity] = useState<'deep' | 'moderate' | 'shallow'>('moderate')

    return (
      <div className="flex flex-col gap-6 max-w-md">
        <SwapImpactGauge
          overallScore={score}
          priceImpact={impact}
          gasCostUsd={gas}
          slippageRisk={slippage}
          liquidityDepth={liquidity}
        />
        <div className="flex flex-col gap-3 bg-suwappu-sakura-50 rounded-suwappu-lg p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-suwappu-text-secondary">Overall Score: {score}</span>
            <input type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-suwappu-text-secondary">Price Impact: {impact.toFixed(1)}%</span>
            <input type="range" min={0} max={100} step={1} value={impact * 10} onChange={(e) => setImpact(Number(e.target.value) / 10)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-suwappu-text-secondary">Gas Cost: ${gas.toFixed(2)}</span>
            <input type="range" min={0} max={500} step={5} value={gas * 10} onChange={(e) => setGas(Number(e.target.value) / 10)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-suwappu-text-secondary">Slippage Risk</span>
            <select
              className="text-sm border rounded-suwappu-md p-1"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value as 'low' | 'medium' | 'high')}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-suwappu-text-secondary">Liquidity Depth</span>
            <select
              className="text-sm border rounded-suwappu-md p-1"
              value={liquidity}
              onChange={(e) => setLiquidity(e.target.value as 'deep' | 'moderate' | 'shallow')}
            >
              <option value="deep">Deep</option>
              <option value="moderate">Moderate</option>
              <option value="shallow">Shallow</option>
            </select>
          </label>
        </div>
      </div>
    )
  },
}

export const SideBySideProviders: Story = {
  args: {} as any,
  render: () => (
    <div className="flex gap-4 items-start">
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs font-medium text-suwappu-text-secondary">CoW Protocol (92)</span>
        <SwapImpactGauge
          overallScore={92}
          priceImpact={0.05}
          gasCostUsd={1.00}
          slippageRisk="low"
          liquidityDepth="deep"
          variant="compact"
        />
      </div>
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs font-medium text-suwappu-text-secondary">Socket (78)</span>
        <SwapImpactGauge
          overallScore={78}
          priceImpact={0.30}
          gasCostUsd={4.50}
          slippageRisk="low"
          liquidityDepth="moderate"
          variant="compact"
        />
      </div>
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs font-medium text-suwappu-text-secondary">Li.Fi (65)</span>
        <SwapImpactGauge
          overallScore={65}
          priceImpact={0.85}
          gasCostUsd={7.00}
          slippageRisk="medium"
          liquidityDepth="moderate"
          variant="compact"
        />
      </div>
    </div>
  ),
}

export const DashboardWidget: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-xs bg-white rounded-suwappu-lg shadow-suwappu-2 border border-suwappu-sakura-200/20 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-suwappu-text-primary">ETH → USDC</span>
        <SwapImpactGauge
          overallScore={84}
          priceImpact={0.15}
          gasCostUsd={2.80}
          slippageRisk="low"
          liquidityDepth="deep"
          variant="mini"
        />
      </div>
      <div className="flex items-baseline gap-1">
        <AnimatedNumber value={2847.53} format="currency" size="lg" />
      </div>
      <div className="text-xs text-suwappu-text-secondary">
        1.5 ETH at $1,898.35/ETH
      </div>
    </div>
  ),
}

export const ProgressiveDetail: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-6 max-w-sm">
      <div>
        <span className="text-xs font-medium text-suwappu-text-secondary mb-2 block">Mini</span>
        <SwapImpactGauge
          overallScore={75}
          priceImpact={0.40}
          gasCostUsd={5.00}
          slippageRisk="low"
          liquidityDepth="moderate"
          variant="mini"
        />
      </div>
      <div>
        <span className="text-xs font-medium text-suwappu-text-secondary mb-2 block">Compact</span>
        <SwapImpactGauge
          overallScore={75}
          priceImpact={0.40}
          gasCostUsd={5.00}
          slippageRisk="low"
          liquidityDepth="moderate"
          variant="compact"
        />
      </div>
      <div>
        <span className="text-xs font-medium text-suwappu-text-secondary mb-2 block">Full</span>
        <SwapImpactGauge
          overallScore={75}
          priceImpact={0.40}
          gasCostUsd={5.00}
          slippageRisk="low"
          liquidityDepth="moderate"
          variant="full"
        />
      </div>
    </div>
  ),
}
