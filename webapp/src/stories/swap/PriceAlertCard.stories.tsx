import type { Meta, StoryObj } from '@storybook/react'
import { PriceAlertCard, type PriceAlert } from '../../components/swap/PriceAlertCard'

const meta = {
  title: 'Swap/PriceAlertCard',
  component: PriceAlertCard,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PriceAlertCard>

export default meta
type Story = StoryObj<typeof meta>

// --- Mock data factories ---

const now = new Date()
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString()
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()

const makeAlert = (overrides: Partial<PriceAlert> & Pick<PriceAlert, 'id'>): PriceAlert => ({
  token: 'Ethereum',
  tokenSymbol: 'ETH',
  currentPrice: 3245.67,
  targetPrice: 3500.0,
  condition: 'above',
  notifyVia: ['app', 'telegram'],
  repeat: false,
  status: 'active',
  createdAt: hoursAgo(2),
  ...overrides,
})

const activeAlerts: PriceAlert[] = [
  makeAlert({ id: 'a1', targetPrice: 3500.0, condition: 'above', createdAt: hoursAgo(1) }),
  makeAlert({ id: 'a2', targetPrice: 3000.0, condition: 'below', createdAt: hoursAgo(3) }),
  makeAlert({ id: 'a3', targetPrice: 3800.0, condition: 'above', notifyVia: ['telegram'], createdAt: hoursAgo(5) }),
]

const triggeredAlerts: PriceAlert[] = [
  makeAlert({
    id: 't1',
    targetPrice: 3200.0,
    condition: 'above',
    status: 'triggered',
    createdAt: daysAgo(2),
    triggeredAt: daysAgo(1),
  }),
  makeAlert({
    id: 't2',
    targetPrice: 3100.0,
    condition: 'below',
    status: 'triggered',
    createdAt: daysAgo(5),
    triggeredAt: daysAgo(3),
  }),
]

const mixedAlerts: PriceAlert[] = [
  makeAlert({ id: 'm1', targetPrice: 3500.0, condition: 'above', status: 'active', createdAt: hoursAgo(1) }),
  makeAlert({ id: 'm2', targetPrice: 3000.0, condition: 'below', status: 'paused', createdAt: hoursAgo(6) }),
  makeAlert({
    id: 'm3',
    targetPrice: 3200.0,
    condition: 'above',
    status: 'triggered',
    createdAt: daysAgo(2),
    triggeredAt: daysAgo(1),
  }),
  makeAlert({
    id: 'm4',
    targetPrice: 2800.0,
    condition: 'below',
    status: 'expired',
    createdAt: daysAgo(7),
  }),
]

const multiTokenAlerts: PriceAlert[] = [
  makeAlert({ id: 'mt1', token: 'Ethereum', tokenSymbol: 'ETH', currentPrice: 3245.67, targetPrice: 3500.0, condition: 'above' }),
  makeAlert({ id: 'mt2', token: 'Bitcoin', tokenSymbol: 'BTC', currentPrice: 62450.0, targetPrice: 65000.0, condition: 'above' }),
  makeAlert({ id: 'mt3', token: 'Solana', tokenSymbol: 'SOL', currentPrice: 148.32, targetPrice: 130.0, condition: 'below' }),
  makeAlert({ id: 'mt4', token: 'Polygon', tokenSymbol: 'MATIC', currentPrice: 0.87, targetPrice: 1.0, condition: 'above', notifyVia: ['app'] }),
]

const logAction = (name: string) => (...args: unknown[]) => console.log(name, ...args)

// --- Stories ---

export const Default: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <PriceAlertCard />
    </div>
  ),
}

export const WithCurrentPrice: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <PriceAlertCard
        onCreateAlert={logAction('onCreateAlert')}
      />
    </div>
  ),
}

export const AboveAlert: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <PriceAlertCard
        alerts={[makeAlert({ id: 'above1', targetPrice: 3800.0, condition: 'above' })]}
        onCreateAlert={logAction('onCreateAlert')}
        onDeleteAlert={logAction('onDeleteAlert')}
        onToggleAlert={logAction('onToggleAlert')}
      />
    </div>
  ),
}

export const BelowAlert: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <PriceAlertCard
        alerts={[makeAlert({ id: 'below1', targetPrice: 2900.0, condition: 'below' })]}
        onCreateAlert={logAction('onCreateAlert')}
        onDeleteAlert={logAction('onDeleteAlert')}
        onToggleAlert={logAction('onToggleAlert')}
      />
    </div>
  ),
}

export const ActiveAlerts: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <PriceAlertCard
        alerts={activeAlerts}
        onCreateAlert={logAction('onCreateAlert')}
        onDeleteAlert={logAction('onDeleteAlert')}
        onToggleAlert={logAction('onToggleAlert')}
      />
    </div>
  ),
}

export const TriggeredAlerts: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <PriceAlertCard
        alerts={triggeredAlerts}
        onDeleteAlert={logAction('onDeleteAlert')}
      />
    </div>
  ),
}

export const MixedStatuses: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <PriceAlertCard
        alerts={mixedAlerts}
        onCreateAlert={logAction('onCreateAlert')}
        onDeleteAlert={logAction('onDeleteAlert')}
        onToggleAlert={logAction('onToggleAlert')}
      />
    </div>
  ),
}

export const RecurringAlert: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <PriceAlertCard
        alerts={[
          makeAlert({ id: 'rec1', targetPrice: 3500.0, condition: 'above', repeat: true }),
          makeAlert({ id: 'rec2', targetPrice: 3000.0, condition: 'below', repeat: true, notifyVia: ['telegram'] }),
        ]}
        onCreateAlert={logAction('onCreateAlert')}
        onDeleteAlert={logAction('onDeleteAlert')}
        onToggleAlert={logAction('onToggleAlert')}
      />
    </div>
  ),
}

export const MultipleTokens: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <PriceAlertCard
        alerts={multiTokenAlerts}
        onCreateAlert={logAction('onCreateAlert')}
        onDeleteAlert={logAction('onDeleteAlert')}
        onToggleAlert={logAction('onToggleAlert')}
      />
    </div>
  ),
}

export const CompactView: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-[280px]">
      <PriceAlertCard
        alerts={[
          makeAlert({ id: 'c1', targetPrice: 3500.0, condition: 'above' }),
          makeAlert({ id: 'c2', targetPrice: 3000.0, condition: 'below', status: 'triggered', triggeredAt: hoursAgo(1) }),
        ]}
        onDeleteAlert={logAction('onDeleteAlert')}
        onToggleAlert={logAction('onToggleAlert')}
      />
    </div>
  ),
}
