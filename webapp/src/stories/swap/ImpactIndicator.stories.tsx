import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { ImpactIndicator } from '../../components/swap/ImpactIndicator'

const meta = {
  title: 'Swap/ImpactIndicator',
  component: ImpactIndicator,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    value: { control: { type: 'number', step: 0.1 } },
    format: { control: 'select', options: ['percent', 'usd', 'score'] },
    variant: { control: 'select', options: ['badge', 'inline', 'dot', 'meter'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof ImpactIndicator>

export default meta
type Story = StoryObj<typeof meta>

export const AllSeverities: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-3">
      <ImpactIndicator value={0.05} variant="badge" />
      <ImpactIndicator value={0.3} variant="badge" />
      <ImpactIndicator value={1.2} variant="badge" />
      <ImpactIndicator value={4.2} variant="badge" />
      <ImpactIndicator value={7.5} variant="badge" />
    </div>
  ),
}

export const InlineVariant: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-suwappu-text-secondary">Price Impact:</span>
        <ImpactIndicator value={0.05} variant="inline" />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-suwappu-text-secondary">Price Impact:</span>
        <ImpactIndicator value={0.3} variant="inline" />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-suwappu-text-secondary">Price Impact:</span>
        <ImpactIndicator value={1.2} variant="inline" />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-suwappu-text-secondary">Price Impact:</span>
        <ImpactIndicator value={4.2} variant="inline" />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-suwappu-text-secondary">Price Impact:</span>
        <ImpactIndicator value={7.5} variant="inline" />
      </div>
    </div>
  ),
}

export const DotVariant: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-2">
      <ImpactIndicator value={0.05} variant="dot" />
      <ImpactIndicator value={0.3} variant="dot" />
      <ImpactIndicator value={1.2} variant="dot" />
      <ImpactIndicator value={4.2} variant="dot" />
      <ImpactIndicator value={7.5} variant="dot" />
    </div>
  ),
}

export const MeterVariant: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-6 max-w-sm">
      <ImpactIndicator value={0.05} variant="meter" />
      <ImpactIndicator value={0.3} variant="meter" />
      <ImpactIndicator value={1.2} variant="meter" />
      <ImpactIndicator value={4.2} variant="meter" />
      <ImpactIndicator value={7.5} variant="meter" />
    </div>
  ),
}

export const UsdFormat: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-3">
      <ImpactIndicator value={0.02} format="usd" variant="badge" />
      <ImpactIndicator value={0.25} format="usd" variant="badge" />
      <ImpactIndicator value={1.50} format="usd" variant="badge" />
      <ImpactIndicator value={3.80} format="usd" variant="badge" />
      <ImpactIndicator value={12.00} format="usd" variant="badge" />
    </div>
  ),
}

export const ScoreFormat: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-3">
      <ImpactIndicator
        value={95}
        format="score"
        variant="badge"
        thresholds={{ negligible: 20, low: 40, medium: 60, high: 80 }}
      />
      <ImpactIndicator
        value={72}
        format="score"
        variant="badge"
        thresholds={{ negligible: 20, low: 40, medium: 60, high: 80 }}
      />
      <ImpactIndicator
        value={45}
        format="score"
        variant="badge"
        thresholds={{ negligible: 20, low: 40, medium: 60, high: 80 }}
      />
      <ImpactIndicator
        value={25}
        format="score"
        variant="badge"
        thresholds={{ negligible: 20, low: 40, medium: 60, high: 80 }}
      />
      <ImpactIndicator
        value={10}
        format="score"
        variant="badge"
        thresholds={{ negligible: 20, low: 40, medium: 60, high: 80 }}
      />
    </div>
  ),
}

export const CustomThresholds: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-suwappu-text-secondary mb-1">
        Custom thresholds: negligible &lt; 1, low &lt; 3, medium &lt; 7, high &lt; 10, severe &gt; 10
      </div>
      <ImpactIndicator
        value={0.5}
        variant="badge"
        thresholds={{ negligible: 1, low: 3, medium: 7, high: 10 }}
      />
      <ImpactIndicator
        value={2}
        variant="badge"
        thresholds={{ negligible: 1, low: 3, medium: 7, high: 10 }}
      />
      <ImpactIndicator
        value={5}
        variant="badge"
        thresholds={{ negligible: 1, low: 3, medium: 7, high: 10 }}
      />
      <ImpactIndicator
        value={8}
        variant="badge"
        thresholds={{ negligible: 1, low: 3, medium: 7, high: 10 }}
      />
      <ImpactIndicator
        value={15}
        variant="badge"
        thresholds={{ negligible: 1, low: 3, medium: 7, high: 10 }}
      />
    </div>
  ),
}

export const Sizes: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <div className="text-xs text-suwappu-text-secondary mb-2">Small</div>
        <div className="flex gap-2">
          <ImpactIndicator value={0.3} size="sm" variant="badge" />
          <ImpactIndicator value={0.3} size="sm" variant="inline" />
          <ImpactIndicator value={0.3} size="sm" variant="dot" />
        </div>
      </div>
      <div>
        <div className="text-xs text-suwappu-text-secondary mb-2">Medium (default)</div>
        <div className="flex gap-2">
          <ImpactIndicator value={0.3} size="md" variant="badge" />
          <ImpactIndicator value={0.3} size="md" variant="inline" />
          <ImpactIndicator value={0.3} size="md" variant="dot" />
        </div>
      </div>
      <div>
        <div className="text-xs text-suwappu-text-secondary mb-2">Large</div>
        <div className="flex gap-2">
          <ImpactIndicator value={0.3} size="lg" variant="badge" />
          <ImpactIndicator value={0.3} size="lg" variant="inline" />
          <ImpactIndicator value={0.3} size="lg" variant="dot" />
        </div>
      </div>
      <div className="max-w-sm">
        <div className="text-xs text-suwappu-text-secondary mb-2">Meter sizes</div>
        <div className="flex flex-col gap-4">
          <ImpactIndicator value={1.2} size="sm" variant="meter" />
          <ImpactIndicator value={1.2} size="md" variant="meter" />
          <ImpactIndicator value={1.2} size="lg" variant="meter" />
        </div>
      </div>
    </div>
  ),
}

export const SwapScenarios: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-suwappu-surface">
        <span className="text-sm text-suwappu-text-secondary">$100 USDC → USDT (stablecoin)</span>
        <ImpactIndicator value={0.01} variant="badge" />
      </div>
      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-suwappu-surface">
        <span className="text-sm text-suwappu-text-secondary">$1K ETH → USDC (major pair)</span>
        <ImpactIndicator value={0.3} variant="badge" />
      </div>
      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-suwappu-surface">
        <span className="text-sm text-suwappu-text-secondary">$10K ALT → ETH (mid-cap alt)</span>
        <ImpactIndicator value={1.5} variant="badge" />
      </div>
      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-suwappu-surface">
        <span className="text-sm text-suwappu-text-secondary">$100K whale swap (large cap)</span>
        <ImpactIndicator value={4.2} variant="badge" />
      </div>
      <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-suwappu-surface">
        <span className="text-sm text-suwappu-text-secondary">$5K illiquid micro-cap token</span>
        <ImpactIndicator value={8.5} variant="badge" />
      </div>
    </div>
  ),
}

export const MeterProgression: Story = {
  args: {} as any,
  render: () => (
    <div className="grid grid-cols-5 gap-4">
      {[0.05, 0.3, 1.5, 3.5, 7.0].map((val) => (
        <div key={val} className="flex flex-col gap-2">
          <ImpactIndicator value={val} variant="meter" />
        </div>
      ))}
    </div>
  ),
}

export const AnimatedTransition: Story = {
  args: {} as any,
  render: () => {
    const [value, setValue] = useState(0.5)
    return (
      <div className="flex flex-col gap-6 max-w-md">
        <div className="flex items-center gap-4">
          <label className="text-sm text-suwappu-text-secondary whitespace-nowrap">
            Impact: {value.toFixed(1)}%
          </label>
          <input
            type="range"
            min={0}
            max={10}
            step={0.1}
            value={value}
            onChange={(e) => setValue(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="flex flex-col gap-4">
          <ImpactIndicator value={value} variant="badge" size="lg" />
          <ImpactIndicator value={value} variant="inline" size="lg" />
          <ImpactIndicator value={value} variant="dot" size="lg" />
          <ImpactIndicator value={value} variant="meter" size="lg" />
        </div>
      </div>
    )
  },
}

export const CompactDashboard: Story = {
  args: {} as any,
  render: () => {
    const metrics = [
      { label: 'Price Impact', value: 0.3 },
      { label: 'Gas Efficiency', value: 0.05 },
      { label: 'Liquidity', value: 1.8 },
      { label: 'Route Quality', value: 0.15 },
      { label: 'MEV Risk', value: 4.5 },
      { label: 'Slippage Risk', value: 2.1 },
    ]
    return (
      <div className="grid grid-cols-3 gap-3 max-w-lg">
        {metrics.map((m) => (
          <div key={m.label} className="flex flex-col gap-1 p-3 rounded-lg bg-suwappu-surface">
            <span className="text-xs text-suwappu-text-secondary">{m.label}</span>
            <ImpactIndicator value={m.value} variant="dot" size="sm" />
          </div>
        ))}
      </div>
    )
  },
}

export const WarningThresholds: Story = {
  args: {} as any,
  render: () => {
    const testValues = [0.08, 0.3, 1.0, 3.0, 6.0]
    const profiles = [
      { label: 'Conservative', thresholds: { negligible: 0.05, low: 0.1, medium: 0.5, high: 1.0 } },
      { label: 'Default', thresholds: { negligible: 0.1, low: 0.5, medium: 2.0, high: 5.0 } },
      { label: 'Aggressive', thresholds: { negligible: 0.5, low: 2.0, medium: 5.0, high: 10.0 } },
    ]
    return (
      <div className="flex flex-col gap-6">
        {profiles.map((profile) => (
          <div key={profile.label}>
            <div className="text-sm font-medium text-suwappu-text-primary mb-2">
              {profile.label} ({Object.values(profile.thresholds).join(' / ')})
            </div>
            <div className="flex flex-wrap gap-2">
              {testValues.map((val) => (
                <ImpactIndicator
                  key={val}
                  value={val}
                  variant="badge"
                  thresholds={profile.thresholds}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  },
}

export const FeeDisplay: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {[0.12, 1.5, 5.0, 15.0, 50.0].map((fee) => (
        <ImpactIndicator key={fee} value={fee} format="usd" variant="inline" />
      ))}
    </div>
  ),
}

export const ScoreFormatBadges: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-wrap gap-3">
      {[95, 78, 55, 32, 8].map((score) => (
        <ImpactIndicator
          key={score}
          value={score}
          format="score"
          variant="badge"
          thresholds={{ negligible: 20, low: 40, medium: 60, high: 80 }}
        />
      ))}
    </div>
  ),
}

export const DarkModeAll: Story = {
  args: {} as any,
  render: () => (
    <div className="bg-gray-950 p-6 rounded-xl">
      <div className="flex flex-col gap-6">
        <div>
          <div className="text-xs text-gray-400 mb-2">Badge</div>
          <div className="flex flex-wrap gap-2">
            <ImpactIndicator value={0.05} variant="badge" />
            <ImpactIndicator value={0.3} variant="badge" />
            <ImpactIndicator value={1.5} variant="badge" />
            <ImpactIndicator value={4.0} variant="badge" />
            <ImpactIndicator value={8.0} variant="badge" />
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-2">Inline</div>
          <div className="flex flex-wrap gap-4">
            <ImpactIndicator value={0.05} variant="inline" />
            <ImpactIndicator value={0.3} variant="inline" />
            <ImpactIndicator value={1.5} variant="inline" />
            <ImpactIndicator value={4.0} variant="inline" />
            <ImpactIndicator value={8.0} variant="inline" />
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-2">Dot</div>
          <div className="flex flex-wrap gap-4">
            <ImpactIndicator value={0.05} variant="dot" />
            <ImpactIndicator value={0.3} variant="dot" />
            <ImpactIndicator value={1.5} variant="dot" />
            <ImpactIndicator value={4.0} variant="dot" />
            <ImpactIndicator value={8.0} variant="dot" />
          </div>
        </div>
        <div className="max-w-sm">
          <div className="text-xs text-gray-400 mb-2">Meter</div>
          <div className="flex flex-col gap-4">
            <ImpactIndicator value={0.05} variant="meter" />
            <ImpactIndicator value={1.5} variant="meter" />
            <ImpactIndicator value={8.0} variant="meter" />
          </div>
        </div>
      </div>
    </div>
  ),
}
