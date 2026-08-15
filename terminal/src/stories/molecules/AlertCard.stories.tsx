import type { Meta, StoryObj } from '@storybook/react'
import { AlertCard } from '../../components/alerts/AlertCard'
import type { Alert } from '../../types/api'

const baseAlert: Alert = {
  id: 'alert-eth-1',
  tokenSymbol: 'ETH',
  tokenAddress: '0x0000000000000000000000000000000000000000',
  chain: 'ethereum',
  alertType: 'price_above',
  targetValue: 4200,
  currentPrice: 3985.22,
  status: 'active',
  createdAt: new Date().toISOString(),
}

function SummerBreezeAlertBoard() {
  const alerts: Alert[] = [
    baseAlert,
    {
      ...baseAlert,
      id: 'alert-sol-2',
      tokenSymbol: 'SOL',
      alertType: 'volume_spike',
      targetValue: 2500000,
      currentPrice: 182.5,
      status: 'triggered',
    },
    {
      ...baseAlert,
      id: 'alert-btc-3',
      tokenSymbol: 'BTC',
      tokenAddress: '0x0000000000000000000000000000000000000001',
      chain: 'base',
      alertType: 'price_below',
      targetValue: 64000,
      currentPrice: 66240,
      status: 'inactive',
    },
  ]

  return (
    <div className="relative overflow-hidden rounded-[36px] border border-[#E8DEC9] bg-[#FFFDF8] p-6 shadow-[0_24px_80px_rgba(67,43,28,0.08)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_12%,rgba(244,218,162,0.25),transparent_24%),radial-gradient(circle_at_88%_20%,rgba(255,195,140,0.16),transparent_22%),linear-gradient(180deg,#FFFDFB_0%,#FFF7EB_100%)]" />
      <div className="relative mb-5 max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.36em] text-[#AE9161]">Summer breeze molecule</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#2D211A]">
          Alert cards on a quiet editorial surface
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#7A6653]">
          Review active, triggered, and dormant alerts without losing contrast or hierarchy.
        </p>
      </div>
      <div className="grid gap-3">
        {alerts.map((alert) => (
          <div key={alert.id} className="rounded-[28px] border border-[#E6DAC6] bg-white/96 p-3 shadow-[0_8px_24px_rgba(67,43,28,0.04)]">
            <AlertCard alert={alert} onDelete={() => undefined} />
          </div>
        ))}
      </div>
    </div>
  )
}

const meta = {
  title: 'Molecules/Alert Card',
  component: AlertCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    alert: baseAlert,
    onDelete: () => undefined,
  },
} satisfies Meta<typeof AlertCard>

export default meta

type Story = StoryObj<typeof meta>

export const Active: Story = {}

export const Triggered: Story = {
  args: {
    alert: {
      ...baseAlert,
      id: 'alert-sol-2',
      tokenSymbol: 'SOL',
      alertType: 'volume_spike',
      targetValue: 2500000,
      currentPrice: 182.5,
      status: 'triggered',
    },
  },
}

export const SummerBreeze: Story = {
  render: () => <SummerBreezeAlertBoard />,
}
