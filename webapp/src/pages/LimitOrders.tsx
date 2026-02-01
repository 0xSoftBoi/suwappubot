import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppLayout, AppHeader } from '../components/layout'
import { api, type LimitOrder } from '../lib/api'

const statusColors = {
  active: 'bg-blue-100 text-blue-700',
  filled: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  expired: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatPrice(price: number | null): string {
  if (price === null) return '—'
  return `$${price.toFixed(4)}`
}

function OrderCard({ order, onCancel, isCancelling }: { 
  order: LimitOrder
  onCancel: (id: number) => void
  isCancelling: boolean 
}) {
  const priceDistance = order.currentPrice 
    ? ((order.currentPrice - order.targetPrice) / order.targetPrice * 100)
    : null
  const isClose = priceDistance !== null && Math.abs(priceDistance) < 5
  
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-heading font-semibold text-sm text-suwappu-text">
            {order.fromTokenSymbol} → {order.toTokenSymbol}
          </p>
          <p className="text-xs text-suwappu-text-secondary">
            {order.fromAmount} {order.fromTokenSymbol}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[order.status]}`}>
          {order.status}
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2">
          <p className="text-[10px] text-suwappu-text-secondary">
            Target ({order.triggerType === 'lte' ? '≤' : '≥'})
          </p>
          <p className="font-heading font-bold text-suwappu-purple-deep">
            {formatPrice(order.targetPrice)}
          </p>
        </div>
        <div className={`rounded-lg p-2 ${isClose ? 'bg-green-50' : 'bg-suwappu-sakura-light/30'}`}>
          <p className="text-[10px] text-suwappu-text-secondary">Current Price</p>
          <p className={`font-heading font-bold ${isClose ? 'text-green-600' : 'text-suwappu-text'}`}>
            {formatPrice(order.currentPrice)}
          </p>
        </div>
      </div>
      
      {order.status === 'filled' && order.executedTxHash && (
        <div className="mb-3 p-2 bg-green-50 rounded-lg">
          <p className="text-[10px] text-green-700">
            ✅ Executed at {formatPrice(order.executedPrice)} on {formatTime(order.executedAt)}
          </p>
        </div>
      )}
      
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-suwappu-text-secondary">
          Created {formatTime(order.createdAt)}
        </p>
        {order.status === 'active' && (
          <button
            onClick={() => onCancel(order.id)}
            disabled={isCancelling}
            className="text-xs text-suwappu-error font-medium disabled:opacity-50"
          >
            {isCancelling ? '...' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  )
}

export function LimitOrders() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'active' | 'filled'>('all')
  const [cancellingId, setCancellingId] = useState<number | null>(null)

  // Fetch limit orders
  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ['limitOrders', filter === 'all' ? undefined : filter],
    queryFn: () => api.getLimitOrders(filter === 'all' ? undefined : filter),
    refetchInterval: 30000, // Refresh every 30s to get current prices
  })

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: (orderId: number) => api.cancelLimitOrder(orderId),
    onMutate: (orderId) => setCancellingId(orderId),
    onSettled: () => setCancellingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['limitOrders'] })
    },
  })

  const handleCancel = (id: number) => {
    if (window.confirm('Cancel this limit order?')) {
      cancelMutation.mutate(id)
    }
  }

  return (
    <AppLayout 
      header={<AppHeader title="Limit Orders" showBack onBack={() => navigate(-1)} />} 
      activeNav="swap"
    >
      <div className="p-3 pb-20 space-y-4">
        {/* Create New Order Button */}
        <button
          onClick={() => navigate('/swap?mode=limit')}
          className="w-full py-3 bg-gradient-to-r from-suwappu-magenta-mid to-suwappu-purple-deep text-white font-heading font-semibold rounded-suwappu-xl shadow-suwappu-2 active:scale-[0.98] transition-transform"
        >
          + Create Limit Order
        </button>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {(['all', 'active', 'filled'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 rounded-suwappu-lg text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-suwappu-magenta-mid text-white'
                  : 'bg-white text-suwappu-text-secondary'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <div className="animate-pulse text-suwappu-text-secondary">Loading orders...</div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 rounded-suwappu-xl p-4 text-center">
            <p className="text-red-600 text-sm">Failed to load orders</p>
            <button 
              onClick={() => queryClient.invalidateQueries({ queryKey: ['limitOrders'] })}
              className="mt-2 text-xs text-red-700 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Orders List */}
        {!isLoading && !error && orders.length === 0 && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
              <span className="text-3xl">📈</span>
            </div>
            <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">
              No limit orders yet
            </p>
            <p className="text-xs text-suwappu-text-secondary mb-4">
              Set a target price and we'll execute when it's reached
            </p>
          </div>
        )}

        {!isLoading && !error && orders.length > 0 && (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard 
                key={order.id} 
                order={order} 
                onCancel={handleCancel}
                isCancelling={cancellingId === order.id}
              />
            ))}
          </div>
        )}

        {/* Info Card */}
        <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
          <p className="text-xs text-suwappu-text-secondary">
            💡 <strong>Limit Orders</strong> let you set a target price. Your order executes 
            automatically when the market reaches your price. No need to watch charts!
          </p>
        </div>
      </div>
    </AppLayout>
  )
}
