import type { Meta, StoryObj } from '@storybook/react'
import { DCAScheduler, type DCAPosition } from '../../components/swap/DCAScheduler'

const meta = {
  title: 'Swap/DCAScheduler',
  component: DCAScheduler,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DCAScheduler>

export default meta
type Story = StoryObj<typeof meta>

// --- Mock data factories ---

const mockPosition = (overrides: Partial<DCAPosition> = {}): DCAPosition => ({
  id: 'dca-1',
  buyToken: 'ETH',
  spendToken: 'USDC',
  amountPerInterval: 100,
  frequency: 'daily',
  completedIntervals: 15,
  totalIntervals: 30,
  totalSpent: 1500,
  totalReceived: 0.82,
  avgPrice: 1829,
  currentPrice: 1950,
  status: 'active',
  nextExecution: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
  ...overrides,
})

const noop = () => {}

// --- Stories ---

export const Default: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <DCAScheduler />
    </div>
  ),
}

export const ConfiguredDaily: Story = {
  args: {} as any,
  render: () => {
    // Pre-filled form is shown via the component's internal state defaults;
    // we show it alongside a descriptive position to illustrate the daily ETH/USDC config.
    return (
      <div className="max-w-md space-y-4">
        <DCAScheduler
          onCreateDCA={(config) => alert(JSON.stringify(config, null, 2))}
        />
        <div className="px-3 py-2 rounded-lg bg-suwappu-sakura-50 text-xs text-suwappu-text-secondary">
          Tip: Set Buy=ETH, Spend=USDC, 100 USDC daily for 30 intervals
        </div>
      </div>
    )
  },
}

export const ConfiguredWeekly: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md space-y-4">
      <DCAScheduler
        onCreateDCA={(config) => alert(JSON.stringify(config, null, 2))}
      />
      <div className="px-3 py-2 rounded-lg bg-suwappu-sakura-50 text-xs text-suwappu-text-secondary">
        Tip: Set Buy=SOL, Spend=USDC, 250 USDC weekly for 12 intervals
      </div>
    </div>
  ),
}

export const ActivePosition: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <DCAScheduler
        positions={[mockPosition()]}
        onPauseDCA={(id) => alert(`Pause ${id}`)}
        onCancelDCA={(id) => alert(`Cancel ${id}`)}
      />
    </div>
  ),
}

export const MultiplePositions: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <DCAScheduler
        positions={[
          mockPosition({ id: 'dca-1', status: 'active', completedIntervals: 15, totalIntervals: 30 }),
          mockPosition({
            id: 'dca-2',
            buyToken: 'SOL',
            spendToken: 'USDC',
            amountPerInterval: 250,
            frequency: 'weekly',
            completedIntervals: 5,
            totalIntervals: 12,
            totalSpent: 1250,
            totalReceived: 52.3,
            avgPrice: 23.9,
            currentPrice: 26.4,
            status: 'active',
            nextExecution: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          }),
          mockPosition({
            id: 'dca-3',
            buyToken: 'BTC',
            spendToken: 'USDT',
            amountPerInterval: 500,
            frequency: 'monthly',
            completedIntervals: 2,
            totalIntervals: 6,
            totalSpent: 1000,
            totalReceived: 0.024,
            avgPrice: 41667,
            currentPrice: 43500,
            status: 'paused',
            nextExecution: undefined,
          }),
          mockPosition({
            id: 'dca-4',
            buyToken: 'ARB',
            spendToken: 'USDC',
            amountPerInterval: 50,
            frequency: 'daily',
            completedIntervals: 30,
            totalIntervals: 30,
            totalSpent: 1500,
            totalReceived: 1320,
            avgPrice: 1.14,
            currentPrice: 1.08,
            status: 'completed',
          }),
        ]}
        onPauseDCA={(id) => alert(`Pause ${id}`)}
        onResumeDCA={(id) => alert(`Resume ${id}`)}
        onCancelDCA={(id) => alert(`Cancel ${id}`)}
      />
    </div>
  ),
}

export const CompletedPosition: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <DCAScheduler
        positions={[
          mockPosition({
            id: 'dca-done',
            buyToken: 'ETH',
            spendToken: 'USDC',
            amountPerInterval: 200,
            frequency: 'weekly',
            completedIntervals: 12,
            totalIntervals: 12,
            totalSpent: 2400,
            totalReceived: 1.35,
            avgPrice: 1778,
            currentPrice: 1950,
            status: 'completed',
            nextExecution: undefined,
          }),
        ]}
      />
    </div>
  ),
}

export const PausedPosition: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <DCAScheduler
        positions={[
          mockPosition({
            id: 'dca-paused',
            status: 'paused',
            completedIntervals: 8,
            totalIntervals: 30,
            totalSpent: 800,
            totalReceived: 0.44,
            avgPrice: 1818,
            currentPrice: 1750,
            nextExecution: undefined,
          }),
        ]}
        onResumeDCA={(id) => alert(`Resume ${id}`)}
        onCancelDCA={(id) => alert(`Cancel ${id}`)}
      />
    </div>
  ),
}

export const PerformanceSummary: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md space-y-4">
      {/* Profitable position */}
      <DCAScheduler
        positions={[
          mockPosition({
            id: 'dca-profit',
            buyToken: 'ETH',
            spendToken: 'USDC',
            amountPerInterval: 100,
            frequency: 'daily',
            completedIntervals: 20,
            totalIntervals: 30,
            totalSpent: 2000,
            totalReceived: 1.15,
            avgPrice: 1739,
            currentPrice: 1980,
            status: 'active',
          }),
          mockPosition({
            id: 'dca-loss',
            buyToken: 'SOL',
            spendToken: 'USDC',
            amountPerInterval: 150,
            frequency: 'weekly',
            completedIntervals: 6,
            totalIntervals: 10,
            totalSpent: 900,
            totalReceived: 38.2,
            avgPrice: 23.56,
            currentPrice: 19.80,
            status: 'active',
          }),
        ]}
        onPauseDCA={noop}
        onCancelDCA={noop}
      />
    </div>
  ),
}

export const SchedulePreview: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <DCAScheduler
        onCreateDCA={(config) => alert(JSON.stringify(config, null, 2))}
      />
      <div className="mt-2 px-3 py-2 rounded-lg bg-suwappu-sakura-50 text-xs text-suwappu-text-secondary">
        Fill in the form and click "Show upcoming dates" to see the schedule preview
      </div>
    </div>
  ),
}

export const AllFrequencies: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <DCAScheduler
        positions={[
          mockPosition({
            id: 'dca-hourly',
            frequency: 'hourly',
            completedIntervals: 48,
            totalIntervals: 168,
            amountPerInterval: 10,
            totalSpent: 480,
            totalReceived: 0.26,
            avgPrice: 1846,
            currentPrice: 1900,
            status: 'active',
            nextExecution: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
          }),
          mockPosition({
            id: 'dca-daily',
            frequency: 'daily',
            completedIntervals: 10,
            totalIntervals: 30,
            amountPerInterval: 100,
            totalSpent: 1000,
            totalReceived: 0.55,
            avgPrice: 1818,
            currentPrice: 1950,
            status: 'active',
            nextExecution: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(),
          }),
          mockPosition({
            id: 'dca-weekly',
            frequency: 'weekly',
            completedIntervals: 4,
            totalIntervals: 12,
            amountPerInterval: 250,
            totalSpent: 1000,
            totalReceived: 42.5,
            avgPrice: 23.5,
            currentPrice: 25.1,
            buyToken: 'SOL',
            status: 'active',
            nextExecution: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          }),
          mockPosition({
            id: 'dca-biweekly',
            frequency: 'biweekly',
            completedIntervals: 3,
            totalIntervals: 6,
            amountPerInterval: 500,
            totalSpent: 1500,
            totalReceived: 0.036,
            avgPrice: 41667,
            currentPrice: 44000,
            buyToken: 'BTC',
            spendToken: 'USDT',
            status: 'paused',
            nextExecution: undefined,
          }),
          mockPosition({
            id: 'dca-monthly',
            frequency: 'monthly',
            completedIntervals: 6,
            totalIntervals: 12,
            amountPerInterval: 1000,
            totalSpent: 6000,
            totalReceived: 3.42,
            avgPrice: 1754,
            currentPrice: 1950,
            buyToken: 'ETH',
            status: 'active',
            nextExecution: new Date(Date.now() + 22 * 24 * 60 * 60 * 1000).toISOString(),
          }),
        ]}
        onPauseDCA={noop}
        onResumeDCA={noop}
        onCancelDCA={noop}
      />
    </div>
  ),
}
