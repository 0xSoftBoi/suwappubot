import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AppLayout, AppHeader } from '../components/layout'
import { api, type LimitOrder } from '../lib/api'

const statusColors: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-700',
  executing: 'bg-yellow-100 text-yellow-700',
  filled: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  expired: 'bg-orange-100 text-orange-700',
  failed: 'bg-red-100 text-red-700',
}

const orderTypeLabels: Record<string, string> = {
  limit_buy: 'Limit Buy',
  limit_sell: 'Limit Sell',
  stop_loss: 'Stop Loss',
  take_profit: 'Take Profit',
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatAmount(amount: string, decimals = 18): string {
  const num = parseFloat(amount) / Math.pow(10, decimals)
  if (num < 0.001) return '<0.001'
  if (num < 1) return num.toFixed(4)
  if (num < 1000) return num.toFixed(2)
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function OrderCard({ order, onCancel }: { order: LimitOrder; onCancel: (id: number) => void }) {
  const priceChange = order.currentPrice 
    ? ((order.currentPrice - order.triggerPrice) / order.triggerPrice * 100)
    : 0
  const isClose = Math.abs(priceChange) < 5
  
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-heading font-semibold text-sm text-suwappu-text">
            {order.fromTokenSymbol} → {order.toTokenSymbol}
          </p>
          <p className="text-xs text-suwappu-text-secondary">
            {formatAmount(order.amount)} {order.fromTokenSymbol} • {orderTypeLabels[order.orderType]}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[order.status] || 'bg-gray-100'}`}>
          {order.status}
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2">
          <p className="text-[10px] text-suwappu-text-secondary">Target Price</p>
          <p className="font-heading font-bold text-suwappu-purple-deep">${order.triggerPrice.toFixed(2)}</p>
        </div>
        <div className={`rounded-lg p-2 ${isClose ? 'bg-green-50' : 'bg-suwappu-sakura-light/30'}`}>
          <p className="text-[10px] text-suwappu-text-secondary">Current Price</p>
          <p className={`font-heading font-bold ${isClose ? 'text-green-600' : 'text-suwappu-text'}`}>
            ${order.currentPrice?.toFixed(2) || 'N/A'}
          </p>
        </div>
      </div>
      
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-suwappu-text-secondary">
          Created {formatTime(order.createdAt)}
        </p>
        {order.status === 'pending' && (
          <button
            onClick={() => onCancel(order.id)}
            className="text-xs text-suwappu-error font-medium"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

export function LimitOrders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<LimitOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'filled'>('all')

  useEffect(() => {
    loadOrders()
  }, [])

  const loadOrders = async () => {
    try {
      setLoading(true)
      const data = await api.getOrders()
      setOrders(data)
    } catch (err: any) {
      toast.error(err.detail || 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async (id: number) => {
    try {
      await api.cancelOrder(id)
      setOrders(orders.map(o => o.id === id ? { ...o, status: 'cancelled' as const } : o))
      toast.success('Order cancelled')
    } catch (err: any) {
      toast.error(err.detail || 'Failed to cancel order')
    }
  }

  const filteredOrders = orders.filter(o => {
    if (filter === 'all') return true
    if (filter === 'pending') return o.status === 'pending' || o.status === 'executing'
    if (filter === 'filled') return o.status === 'filled'
    return true
  })

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
          {(['all', 'pending', 'filled'] as const).map((f) => (
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

        {/* Loading state */}
        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-suwappu-purple-deep border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-suwappu-text-secondary text-sm">Loading orders...</p>
          </div>
        )}

        {/* Orders List */}
        {!loading && filteredOrders.length === 0 ? (
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
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <OrderCard key={order.id} order={order} onCancel={handleCancel} />
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
