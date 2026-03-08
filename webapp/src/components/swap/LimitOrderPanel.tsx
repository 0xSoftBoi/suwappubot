import React, { useState, useCallback, useMemo } from 'react'

export interface LimitOrder {
  id: string
  type: 'buy' | 'sell'
  fromToken: string
  toToken: string
  price: number
  amount: number
  filled: number
  expiry: string
  status: 'active' | 'filled' | 'expired' | 'cancelled'
  createdAt: string
}

export interface LimitOrderPanelProps {
  currentPrice?: number
  fromToken?: string
  toToken?: string
  onSubmit?: (order: LimitOrder) => void
  onCancel?: (orderId: string) => void
  activeOrders?: LimitOrder[]
  className?: string
}

const EXPIRY_OPTIONS = [
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: 'Custom', value: 'custom' },
] as const

type ExpiryValue = (typeof EXPIRY_OPTIONS)[number]['value']

function StatusBadge({ status }: { status: LimitOrder['status'] }) {
  const colorMap: Record<LimitOrder['status'], string> = {
    active: 'bg-green-500/10 text-green-500',
    filled: 'bg-suwappu-success/10 text-suwappu-success',
    expired: 'bg-gray-400/10 text-suwappu-text-secondary/60',
    cancelled: 'bg-red-400/10 text-red-400',
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-suwappu-pill text-xs font-medium ${colorMap[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function ProgressBar({ filled, amount }: { filled: number; amount: number }) {
  const pct = amount > 0 ? Math.min((filled / amount) * 100, 100) : 0
  return (
    <div className="w-full h-1.5 bg-suwappu-sakura-50 rounded-suwappu-pill overflow-hidden">
      <div
        className="h-full bg-suwappu-magenta rounded-suwappu-pill transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export const LimitOrderPanel = React.memo(function LimitOrderPanel({
  currentPrice,
  fromToken: defaultFromToken = '',
  toToken: defaultToToken = '',
  onSubmit,
  onCancel,
  activeOrders = [],
  className = '',
}: LimitOrderPanelProps) {
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('buy')
  const [fromToken, setFromToken] = useState(defaultFromToken)
  const [toToken, setToToken] = useState(defaultToToken)
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [expiry, setExpiry] = useState<ExpiryValue>('24h')
  const [customExpiry, setCustomExpiry] = useState('')
  const [showSummary, setShowSummary] = useState(false)

  const priceNum = parseFloat(price) || 0
  const amountNum = parseFloat(amount) || 0

  const priceDiff = useMemo(() => {
    if (!currentPrice || !priceNum) return null
    const diff = ((priceNum - currentPrice) / currentPrice) * 100
    return diff
  }, [currentPrice, priceNum])

  const total = useMemo(() => priceNum * amountNum, [priceNum, amountNum])

  const handleSetMarketPrice = useCallback(() => {
    if (currentPrice) {
      setPrice(currentPrice.toString())
    }
  }, [currentPrice])

  const handleSubmit = useCallback(() => {
    if (!fromToken || !toToken || !priceNum || !amountNum) return

    const order: LimitOrder = {
      id: `order-${Date.now()}`,
      type: orderType,
      fromToken,
      toToken,
      price: priceNum,
      amount: amountNum,
      filled: 0,
      expiry: expiry === 'custom' ? customExpiry : expiry,
      status: 'active',
      createdAt: new Date().toISOString(),
    }

    onSubmit?.(order)
    setShowSummary(false)
    setPrice('')
    setAmount('')
  }, [fromToken, toToken, priceNum, amountNum, orderType, expiry, customExpiry, onSubmit])

  const handleReview = useCallback(() => {
    if (fromToken && toToken && priceNum && amountNum) {
      setShowSummary(true)
    }
  }, [fromToken, toToken, priceNum, amountNum])

  const canSubmit = fromToken && toToken && priceNum > 0 && amountNum > 0

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Order Creation Card */}
      <div className="bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 p-4">
        <h3 className="font-heading font-semibold text-suwappu-text mb-4">
          Limit Order
        </h3>

        {/* Order Type Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setOrderType('buy')}
            className={`flex-1 py-2 rounded-suwappu-pill text-sm font-medium transition-colors ${
              orderType === 'buy'
                ? 'bg-suwappu-magenta text-white'
                : 'bg-suwappu-sakura-100 text-suwappu-text'
            }`}
          >
            Limit Buy
          </button>
          <button
            type="button"
            onClick={() => setOrderType('sell')}
            className={`flex-1 py-2 rounded-suwappu-pill text-sm font-medium transition-colors ${
              orderType === 'sell'
                ? 'bg-suwappu-magenta text-white'
                : 'bg-suwappu-sakura-100 text-suwappu-text'
            }`}
          >
            Limit Sell
          </button>
        </div>

        {/* Token Pair */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-suwappu-text-secondary mb-1">
              From
            </label>
            <input
              type="text"
              value={fromToken}
              onChange={(e) => setFromToken(e.target.value)}
              placeholder="e.g. ETH"
              className="w-full px-3 py-2 text-sm bg-suwappu-sakura-50 border border-suwappu-sakura-200/30 rounded-suwappu-md text-suwappu-text placeholder:text-suwappu-text-secondary/50 outline-none focus:border-suwappu-magenta/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-suwappu-text-secondary mb-1">
              To
            </label>
            <input
              type="text"
              value={toToken}
              onChange={(e) => setToToken(e.target.value)}
              placeholder="e.g. USDC"
              className="w-full px-3 py-2 text-sm bg-suwappu-sakura-50 border border-suwappu-sakura-200/30 rounded-suwappu-md text-suwappu-text placeholder:text-suwappu-text-secondary/50 outline-none focus:border-suwappu-magenta/50 transition-colors"
            />
          </div>
        </div>

        {/* Price Input */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-suwappu-text-secondary">
              Price
            </label>
            {currentPrice != null && (
              <button
                type="button"
                onClick={handleSetMarketPrice}
                className="text-xs text-suwappu-magenta hover:underline"
              >
                Market: {currentPrice.toLocaleString()}
              </button>
            )}
          </div>
          <input
            type="number"
            min="0"
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 text-sm bg-suwappu-sakura-50 border border-suwappu-sakura-200/30 rounded-suwappu-md text-suwappu-text placeholder:text-suwappu-text-secondary/50 outline-none focus:border-suwappu-magenta/50 transition-colors"
          />
          {priceDiff !== null && (
            <div className={`mt-1 text-xs font-medium ${priceDiff > 0 ? 'text-green-500' : priceDiff < 0 ? 'text-red-400' : 'text-suwappu-text-secondary'}`}>
              {priceDiff > 0 ? '+' : ''}{priceDiff.toFixed(2)}% {priceDiff > 0 ? 'above' : priceDiff < 0 ? 'below' : 'at'} market
            </div>
          )}
        </div>

        {/* Amount Input */}
        <div className="mb-4">
          <label className="block text-xs text-suwappu-text-secondary mb-1">
            Amount
          </label>
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 text-sm bg-suwappu-sakura-50 border border-suwappu-sakura-200/30 rounded-suwappu-md text-suwappu-text placeholder:text-suwappu-text-secondary/50 outline-none focus:border-suwappu-magenta/50 transition-colors"
          />
          {total > 0 && (
            <div className="mt-1 text-xs text-suwappu-text-secondary">
              Total: ~${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>

        {/* Expiry Selector */}
        <div className="mb-4">
          <label className="block text-xs text-suwappu-text-secondary mb-2">
            Expires in
          </label>
          <div className="flex flex-wrap gap-2">
            {EXPIRY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setExpiry(opt.value)}
                className={`px-3 py-1.5 rounded-suwappu-pill text-xs font-medium transition-colors ${
                  expiry === opt.value
                    ? 'bg-suwappu-magenta text-white'
                    : 'bg-suwappu-sakura-100 text-suwappu-text hover:bg-suwappu-sakura-100/80'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {expiry === 'custom' && (
            <input
              type="text"
              value={customExpiry}
              onChange={(e) => setCustomExpiry(e.target.value)}
              placeholder="e.g. 2h 30m"
              className="mt-2 w-full px-3 py-2 text-sm bg-suwappu-sakura-50 border border-suwappu-sakura-200/30 rounded-suwappu-md text-suwappu-text placeholder:text-suwappu-text-secondary/50 outline-none focus:border-suwappu-magenta/50 transition-colors"
            />
          )}
        </div>

        {/* Review / Submit Button */}
        {!showSummary ? (
          <button
            type="button"
            onClick={handleReview}
            disabled={!canSubmit}
            className={`w-full py-3 rounded-suwappu-pill text-sm font-semibold transition-colors ${
              canSubmit
                ? 'bg-suwappu-magenta text-white hover:bg-suwappu-magenta/90'
                : 'bg-suwappu-sakura-100 text-suwappu-text-secondary cursor-not-allowed'
            }`}
          >
            Review Order
          </button>
        ) : (
          /* Order Summary */
          <div className="space-y-3">
            <div className="bg-suwappu-sakura-50 rounded-suwappu-md p-3 space-y-2">
              <h4 className="text-xs font-semibold text-suwappu-text uppercase tracking-wide">
                Order Summary
              </h4>
              <div className="flex justify-between text-sm">
                <span className="text-suwappu-text-secondary">Type</span>
                <span className="text-suwappu-text font-medium capitalize">
                  Limit {orderType}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-suwappu-text-secondary">Pair</span>
                <span className="text-suwappu-text font-medium">
                  {fromToken}/{toToken}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-suwappu-text-secondary">Price</span>
                <span className="text-suwappu-text font-medium">
                  {priceNum.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-suwappu-text-secondary">Amount</span>
                <span className="text-suwappu-text font-medium">
                  {amountNum.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-suwappu-text-secondary">Total</span>
                <span className="text-suwappu-text font-medium">
                  ~${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-suwappu-text-secondary">Expiry</span>
                <span className="text-suwappu-text font-medium">
                  {expiry === 'custom' ? customExpiry || 'Not set' : expiry}
                </span>
              </div>
              {priceDiff !== null && (
                <div className="flex justify-between text-sm">
                  <span className="text-suwappu-text-secondary">vs Market</span>
                  <span className={`font-medium ${priceDiff > 0 ? 'text-green-500' : priceDiff < 0 ? 'text-red-400' : 'text-suwappu-text-secondary'}`}>
                    {priceDiff > 0 ? '+' : ''}{priceDiff.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowSummary(false)}
                className="flex-1 py-3 rounded-suwappu-pill text-sm font-semibold bg-suwappu-sakura-100 text-suwappu-text transition-colors hover:bg-suwappu-sakura-100/80"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="flex-1 py-3 rounded-suwappu-pill text-sm font-semibold bg-suwappu-magenta text-white transition-colors hover:bg-suwappu-magenta/90"
              >
                Confirm {orderType === 'buy' ? 'Buy' : 'Sell'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Active Orders List */}
      {activeOrders.length > 0 && (
        <div className="bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 p-4">
          <h3 className="font-heading font-semibold text-suwappu-text mb-3">
            Orders ({activeOrders.length})
          </h3>
          <div className="space-y-3">
            {activeOrders.map((order) => (
              <div
                key={order.id}
                className="bg-suwappu-sakura-50 rounded-suwappu-md p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold uppercase ${order.type === 'buy' ? 'text-green-500' : 'text-red-400'}`}>
                      {order.type}
                    </span>
                    <span className="text-sm font-medium text-suwappu-text">
                      {order.fromToken}/{order.toToken}
                    </span>
                  </div>
                  <StatusBadge status={order.status} />
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                  <div>
                    <span className="text-suwappu-text-secondary block">Price</span>
                    <span className="text-suwappu-text font-medium">
                      {order.price.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-suwappu-text-secondary block">Amount</span>
                    <span className="text-suwappu-text font-medium">
                      {order.amount.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-suwappu-text-secondary block">Expiry</span>
                    <span className="text-suwappu-text font-medium">
                      {order.expiry}
                    </span>
                  </div>
                </div>

                <ProgressBar filled={order.filled} amount={order.amount} />
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-suwappu-text-secondary">
                    {order.filled}/{order.amount} filled
                  </span>
                  {order.status === 'active' && onCancel && (
                    <button
                      type="button"
                      onClick={() => onCancel(order.id)}
                      className="text-xs text-red-400 hover:text-red-500 font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})
