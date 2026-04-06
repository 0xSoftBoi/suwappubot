import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AppLayout, AppHeader } from '../components/layout'
import { api, type DCAOrder, type DCAStats } from '../lib/api'

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

const intervalLabels: Record<number, string> = {
  60: 'Hourly',
  360: 'Every 6h',
  720: 'Every 12h',
  1440: 'Daily',
  10080: 'Weekly',
}

function formatInterval(minutes: number): string {
  return intervalLabels[minutes] || `Every ${minutes}m`
}

function OrderCard({
  order,
  onPause,
  onResume,
  onCancel,
}: {
  order: DCAOrder
  onPause: (id: number) => void
  onResume: (id: number) => void
  onCancel: (id: number) => void
}) {
  const progress = order.totalExecutions
    ? Math.round((order.executedCount / order.totalExecutions) * 100)
    : null

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-heading font-semibold text-sm text-suwappu-text">
            {order.fromTokenSymbol} → {order.toTokenSymbol}
          </p>
          <p className="text-xs text-suwappu-text-secondary">
            {order.amountPerExecution} {order.fromTokenSymbol} · {formatInterval(order.intervalMinutes)}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[order.status] || 'bg-gray-100'}`}>
          {order.status}
        </span>
      </div>

      {/* Progress bar */}
      {progress !== null && (
        <div className="mb-2">
          <div className="flex justify-between text-xs text-suwappu-text-secondary mb-1">
            <span>{order.executedCount}/{order.totalExecutions} executions</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-suwappu-primary rounded-full h-1.5"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {order.nextExecutionAt && order.status === 'active' && (
        <p className="text-xs text-suwappu-text-secondary mb-2">
          Next: {new Date(order.nextExecutionAt).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {order.status === 'active' && (
          <button
            onClick={() => onPause(order.id)}
            className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
          >
            Pause
          </button>
        )}
        {order.status === 'paused' && (
          <button
            onClick={() => onResume(order.id)}
            className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100"
          >
            Resume
          </button>
        )}
        {(order.status === 'active' || order.status === 'paused') && (
          <button
            onClick={() => onCancel(order.id)}
            className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-700 hover:bg-red-100"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

export function DCA() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<DCAOrder[]>([])
  const [stats, setStats] = useState<DCAStats | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    try {
      const [ordersData, statsData] = await Promise.all([
        api.getDCAOrders(),
        api.getDCAStats(),
      ])
      setOrders(ordersData)
      setStats(statsData)
    } catch (e) {
      console.error('Failed to fetch DCA data:', e)
      toast.error('Failed to load DCA orders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handlePause = async (id: number) => {
    try {
      await api.pauseDCAOrder(id)
      toast.success('DCA order paused')
      fetchData()
    } catch {
      toast.error('Failed to pause order')
    }
  }

  const handleResume = async (id: number) => {
    try {
      await api.resumeDCAOrder(id)
      toast.success('DCA order resumed')
      fetchData()
    } catch {
      toast.error('Failed to resume order')
    }
  }

  const handleCancel = async (id: number) => {
    try {
      await api.cancelDCAOrder(id)
      toast.success('DCA order cancelled')
      fetchData()
    } catch {
      toast.error('Failed to cancel order')
    }
  }

  const activeOrders = orders.filter(o => o.status === 'active' || o.status === 'paused')
  const pastOrders = orders.filter(o => o.status === 'completed' || o.status === 'cancelled')

  return (
    <AppLayout>
      <AppHeader title="DCA Orders" showBack />

      <div className="p-4 space-y-4">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 text-center">
              <p className="text-xl font-heading font-bold text-suwappu-text">{stats.activeOrders}</p>
              <p className="text-xs text-suwappu-text-secondary">Active</p>
            </div>
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 text-center">
              <p className="text-xl font-heading font-bold text-suwappu-text">{stats.totalExecutions}</p>
              <p className="text-xs text-suwappu-text-secondary">Executions</p>
            </div>
          </div>
        )}

        {/* Create button */}
        <button
          onClick={() => navigate('/dca/new')}
          className="w-full py-3 rounded-suwappu-xl font-heading font-semibold text-white bg-suwappu-primary hover:bg-suwappu-primary/90"
        >
          + Create DCA Order
        </button>

        {/* Active orders */}
        {loading ? (
          <div className="text-center text-suwappu-text-secondary py-8">Loading...</div>
        ) : activeOrders.length > 0 ? (
          <div className="space-y-3">
            <h3 className="font-heading font-semibold text-sm text-suwappu-text">Active Orders</h3>
            {activeOrders.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                onPause={handlePause}
                onResume={handleResume}
                onCancel={handleCancel}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-suwappu-text-secondary text-sm">No active DCA orders</p>
            <p className="text-suwappu-text-secondary text-xs mt-1">
              Create one to automatically buy tokens on a schedule
            </p>
          </div>
        )}

        {/* Past orders */}
        {pastOrders.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-heading font-semibold text-sm text-suwappu-text-secondary">History</h3>
            {pastOrders.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                onPause={handlePause}
                onResume={handleResume}
                onCancel={handleCancel}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

export default DCA
