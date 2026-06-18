import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { LimitOrderPanel, type LimitOrder, type LimitOrderPanelProps } from '../../components/swap/LimitOrderPanel'

const mockActiveOrders: LimitOrder[] = [
  {
    id: 'order-1',
    type: 'buy',
    fromToken: 'USDC',
    toToken: 'ETH',
    price: 1800,
    amount: 2.5,
    filled: 0.8,
    expiry: '24h',
    status: 'active',
    createdAt: '2026-03-07T10:00:00Z',
  },
  {
    id: 'order-2',
    type: 'sell',
    fromToken: 'ETH',
    toToken: 'USDC',
    price: 2200,
    amount: 1.0,
    filled: 0,
    expiry: '7d',
    status: 'active',
    createdAt: '2026-03-06T14:30:00Z',
  },
  {
    id: 'order-3',
    type: 'buy',
    fromToken: 'USDC',
    toToken: 'ARB',
    price: 0.85,
    amount: 500,
    filled: 200,
    expiry: '4h',
    status: 'active',
    createdAt: '2026-03-07T08:15:00Z',
  },
]

const allStatusOrders: LimitOrder[] = [
  {
    id: 'order-active',
    type: 'buy',
    fromToken: 'USDC',
    toToken: 'ETH',
    price: 1800,
    amount: 2.5,
    filled: 0.8,
    expiry: '24h',
    status: 'active',
    createdAt: '2026-03-07T10:00:00Z',
  },
  {
    id: 'order-filled',
    type: 'sell',
    fromToken: 'ETH',
    toToken: 'USDC',
    price: 2100,
    amount: 1.0,
    filled: 1.0,
    expiry: '7d',
    status: 'filled',
    createdAt: '2026-03-05T09:00:00Z',
  },
  {
    id: 'order-expired',
    type: 'buy',
    fromToken: 'USDC',
    toToken: 'MATIC',
    price: 0.65,
    amount: 1000,
    filled: 350,
    expiry: '1h',
    status: 'expired',
    createdAt: '2026-03-06T18:00:00Z',
  },
  {
    id: 'order-cancelled',
    type: 'sell',
    fromToken: 'ARB',
    toToken: 'USDC',
    price: 1.5,
    amount: 300,
    filled: 0,
    expiry: '30d',
    status: 'cancelled',
    createdAt: '2026-03-04T12:00:00Z',
  },
]

function InteractiveWrapper(props: LimitOrderPanelProps) {
  const [orders, setOrders] = useState<LimitOrder[]>(props.activeOrders ?? [])

  return (
    <LimitOrderPanel
      {...props}
      activeOrders={orders}
      onSubmit={(order) => {
        console.log('Order submitted:', order)
        setOrders((prev) => [order, ...prev])
      }}
      onCancel={(id) => {
        console.log('Order cancelled:', id)
        setOrders((prev) => prev.filter((o) => o.id !== id))
      }}
    />
  )
}

const meta = {
  title: 'Swap/LimitOrderPanel',
  component: LimitOrderPanel,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-md mx-auto">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LimitOrderPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {} as any,
  render: () => <LimitOrderPanel />,
}

export const WithMarketPrice: Story = {
  args: {} as any,
  render: () => (
    <LimitOrderPanel
      currentPrice={2045.67}
      fromToken="USDC"
      toToken="ETH"
    />
  ),
}

export const BuyOrder: Story = {
  args: {} as any,
  render: () => {
    const [submitted, setSubmitted] = useState<LimitOrder | null>(null)
    return (
      <div className="space-y-3">
        <LimitOrderPanel
          currentPrice={2045.67}
          fromToken="USDC"
          toToken="ETH"
          onSubmit={(order) => setSubmitted(order)}
        />
        {submitted && (
          <div className="bg-green-50 border border-green-200 rounded-suwappu-md p-3 text-xs text-green-700">
            Buy order submitted: {submitted.amount} {submitted.toToken} @ {submitted.price}
          </div>
        )}
      </div>
    )
  },
}

export const SellOrder: Story = {
  args: {} as any,
  render: () => {
    const [submitted, setSubmitted] = useState<LimitOrder | null>(null)
    return (
      <div className="space-y-3">
        <LimitOrderPanel
          currentPrice={2045.67}
          fromToken="ETH"
          toToken="USDC"
          onSubmit={(order) => setSubmitted(order)}
        />
        {submitted && (
          <div className="bg-green-50 border border-green-200 rounded-suwappu-md p-3 text-xs text-green-700">
            Sell order submitted: {submitted.amount} {submitted.fromToken} @ {submitted.price}
          </div>
        )}
      </div>
    )
  },
}

export const WithActiveOrders: Story = {
  args: {} as any,
  render: () => (
    <InteractiveWrapper
      currentPrice={2045.67}
      fromToken="USDC"
      toToken="ETH"
      activeOrders={mockActiveOrders}
    />
  ),
}

export const AllOrderStatuses: Story = {
  args: {} as any,
  render: () => (
    <LimitOrderPanel
      currentPrice={2045.67}
      fromToken="USDC"
      toToken="ETH"
      activeOrders={allStatusOrders}
      onCancel={(id) => console.log('Cancel:', id)}
    />
  ),
}

export const ExpiryOptions: Story = {
  args: {} as any,
  render: () => (
    <LimitOrderPanel
      currentPrice={2045.67}
      fromToken="USDC"
      toToken="ETH"
    />
  ),
}

export const PriceComparison: Story = {
  args: {} as any,
  render: () => {
    const marketPrice = 2045.67
    const presets = [
      { label: '5% below market', price: marketPrice * 0.95 },
      { label: 'At market', price: marketPrice },
      { label: '5% above market', price: marketPrice * 1.05 },
    ]
    return (
      <div className="space-y-4">
        <p className="text-xs text-suwappu-text-secondary text-center">
          Market price: ${marketPrice.toLocaleString()} -- enter different prices to see % comparison
        </p>
        {presets.map((preset) => (
          <div key={preset.label}>
            <p className="text-xs font-medium text-suwappu-text mb-1">{preset.label}: ${preset.price.toFixed(2)}</p>
            <LimitOrderPanel
              currentPrice={marketPrice}
              fromToken="USDC"
              toToken="ETH"
            />
          </div>
        ))}
      </div>
    )
  },
}

export const OrderSummary: Story = {
  args: {} as any,
  render: () => {
    return (
      <div className="space-y-2">
        <p className="text-xs text-suwappu-text-secondary text-center">
          Fill in the fields and click "Review Order" to see the confirmation summary.
        </p>
        <LimitOrderPanel
          currentPrice={2045.67}
          fromToken="USDC"
          toToken="ETH"
          onSubmit={(order) => console.log('Submitted:', order)}
        />
      </div>
    )
  },
}

export const MobileLayout: Story = {
  args: {} as any,
  decorators: [
    (Story) => (
      <div className="max-w-[360px] mx-auto">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <InteractiveWrapper
      currentPrice={2045.67}
      fromToken="USDC"
      toToken="ETH"
      activeOrders={mockActiveOrders.slice(0, 2)}
    />
  ),
}
