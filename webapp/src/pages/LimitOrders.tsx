import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'

// Mock limit orders for UI (API integration pending)
interface LimitOrder {
  id: string
  fromToken: string
  toToken: string
  fromAmount: string
  targetPrice: string
  currentPrice: string
  status: 'active' | 'filled' | 'cancelled' | 'expired'
  createdAt: string
  expiresAt?: string
}

const mockOrders: LimitOrder[] = []

const statusColors = {
  active: 'bg-blue-100 text-blue-700',
  filled: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  expired: 'bg-yellow-100 text-yellow-700',
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function OrderCard({ order, onCancel }: { order: LimitOrder; onCancel: (id: string) => void }) {
  const priceChange = ((parseFloat(order.currentPrice) - parseFloat(order.targetPrice)) / parseFloat(order.targetPrice) * 100)
  const isClose = Math.abs(priceChange) < 5
  
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-heading font-semibold text-sm text-suwappu-text">
            {order.fromToken} → {order.toToken}
          </p>
          <p className="text-xs text-suwappu-text-secondary">
            {order.fromAmount} {order.fromToken}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[order.status]}`}>
          {order.status}
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-suwappu-sakura-light/30 rounded-lg p-2">
          <p className="text-[10px] text-suwappu-text-secondary">Target Price</p>
          <p className="font-heading font-bold text-suwappu-purple-deep">${order.targetPrice}</p>
        </div>
        <div className={`rounded-lg p-2 ${isClose ? 'bg-green-50' : 'bg-suwappu-sakura-light/30'}`}>
          <p className="text-[10px] text-suwappu-text-secondary">Current Price</p>
          <p className={`font-heading font-bold ${isClose ? 'text-green-600' : 'text-suwappu-text'}`}>
            ${order.currentPrice}
          </p>
        </div>
      </div>
      
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-suwappu-text-secondary">
          Created {formatTime(order.createdAt)}
        </p>
        {order.status === 'active' && (
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
  const [orders, setOrders] = useState<LimitOrder[]>(mockOrders)
  const [filter, setFilter] = useState<'all' | 'active' | 'filled'>('all')

  const filteredOrders = orders.filter(o => filter === 'all' || o.status === filter)

  const handleCancel = (id: string) => {
    setOrders(orders.map(o => o.id === id ? { ...o, status: 'cancelled' as const } : o))
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

        {/* Orders List */}
        {filteredOrders.length === 0 ? (
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

        {/* Coming Soon Badge */}
        <div className="text-center">
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">
            🚧 Backend integration coming soon
          </span>
        </div>
      </div>
    </AppLayout>
  )
}
