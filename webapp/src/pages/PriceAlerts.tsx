import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AppLayout, AppHeader } from '../components/layout'
import { api, type PriceAlert, type CreateAlertParams } from '../lib/api'

const tokenIcons: Record<string, string> = {
  ETH: 'Ξ',
  SOL: '◎',
  BTC: '₿',
  USDC: '$',
}

const alertTypeLabels: Record<string, string> = {
  above: 'Price above',
  below: 'Price below',
  change_pct: 'Change %',
}

function AlertCard({ alert, onToggle, onDelete }: { 
  alert: PriceAlert
  onToggle: (id: number) => void
  onDelete: (id: number) => void 
}) {
  const icon = tokenIcons[alert.tokenSymbol] || alert.tokenSymbol[0]
  
  return (
    <div className={`bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 ${!alert.isActive && !alert.isTriggered ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-suwappu-purple-deep text-white flex items-center justify-center text-lg font-bold">
          {icon}
        </div>
        
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <p className="font-heading font-semibold text-sm text-suwappu-text">{alert.tokenSymbol}</p>
            {alert.isTriggered ? (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                ✓ Triggered
              </span>
            ) : (
              <button
                onClick={() => onToggle(alert.id)}
                className={`w-10 h-5 rounded-full transition-colors ${
                  alert.isActive ? 'bg-suwappu-magenta-mid' : 'bg-gray-200'
                }`}
              >
                <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  alert.isActive ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            )}
          </div>
          
          <p className="text-xs text-suwappu-text-secondary mb-2">
            {alertTypeLabels[alert.alertType]}{' '}
            {alert.alertType === 'change_pct' 
              ? `${alert.changePercent}%`
              : `$${alert.targetPrice?.toFixed(2)}`
            }
          </p>
          
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-suwappu-text-secondary">
              Current: ${alert.currentPrice?.toFixed(2) || 'N/A'}
            </p>
            <button
              onClick={() => onDelete(alert.id)}
              className="text-[10px] text-suwappu-error"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CreateAlertModal({ isOpen, onClose, onSave }: {
  isOpen: boolean
  onClose: () => void
  onSave: (params: CreateAlertParams) => void
}) {
  const [token, setToken] = useState('ETH')
  const [alertType, setAlertType] = useState<'above' | 'below' | 'change_pct'>('above')
  const [targetPrice, setTargetPrice] = useState('')
  const [changePercent, setChangePercent] = useState('')

  const tokens = [
    { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000' },
    { symbol: 'BTC', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' },
    { symbol: 'SOL', address: '0x0000000000000000000000000000000000000000' },
  ]

  const handleSave = () => {
    const selectedToken = tokens.find(t => t.symbol === token)
    if (!selectedToken) return

    onSave({
      chain: 'ethereum',
      tokenAddress: selectedToken.address,
      tokenSymbol: token,
      alertType,
      targetPrice: alertType !== 'change_pct' ? parseFloat(targetPrice) : undefined,
      changePercent: alertType === 'change_pct' ? parseFloat(changePercent) : undefined,
    })
    onClose()
    setTargetPrice('')
    setChangePercent('')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-4 pb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-semibold text-lg">Create Alert</h3>
          <button onClick={onClose} className="text-2xl text-suwappu-text-secondary">×</button>
        </div>

        {/* Token selection */}
        <div className="mb-4">
          <label className="block text-xs text-suwappu-text-secondary mb-2">Token</label>
          <div className="flex gap-2">
            {tokens.map((t) => (
              <button
                key={t.symbol}
                onClick={() => setToken(t.symbol)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  token === t.symbol
                    ? 'bg-suwappu-purple-deep text-white'
                    : 'bg-suwappu-sakura-light/50 text-suwappu-text'
                }`}
              >
                {t.symbol}
              </button>
            ))}
          </div>
        </div>

        {/* Alert type */}
        <div className="mb-4">
          <label className="block text-xs text-suwappu-text-secondary mb-2">Alert Type</label>
          <div className="flex gap-2">
            {(['above', 'below', 'change_pct'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setAlertType(type)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                  alertType === type
                    ? 'bg-suwappu-purple-deep text-white'
                    : 'bg-suwappu-sakura-light/50 text-suwappu-text'
                }`}
              >
                {alertTypeLabels[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Price/Percent input */}
        <div className="mb-6">
          <label className="block text-xs text-suwappu-text-secondary mb-2">
            {alertType === 'change_pct' ? 'Change Percentage' : 'Target Price'}
          </label>
          {alertType === 'change_pct' ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={changePercent}
                onChange={(e) => setChangePercent(e.target.value)}
                placeholder="5"
                className="flex-1 p-3 rounded-lg border border-gray-200 text-lg"
              />
              <span className="text-lg font-medium">%</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-lg font-medium">$</span>
              <input
                type="number"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="2000"
                className="flex-1 p-3 rounded-lg border border-gray-200 text-lg"
              />
            </div>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={alertType === 'change_pct' ? !changePercent : !targetPrice}
          className="w-full py-3 bg-gradient-suwappu text-white font-heading font-semibold rounded-xl disabled:opacity-50"
        >
          Create Alert
        </button>
      </div>
    </div>
  )
}

export function PriceAlerts() {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    loadAlerts()
  }, [])

  const loadAlerts = async () => {
    try {
      setLoading(true)
      const data = await api.getAlerts()
      setAlerts(data)
    } catch (err: any) {
      toast.error(err.detail || 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (id: number) => {
    try {
      const updated = await api.toggleAlert(id)
      setAlerts(alerts.map(a => a.id === id ? updated : a))
    } catch (err: any) {
      toast.error(err.detail || 'Failed to toggle alert')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.deleteAlert(id)
      setAlerts(alerts.filter(a => a.id !== id))
      toast.success('Alert deleted')
    } catch (err: any) {
      toast.error(err.detail || 'Failed to delete alert')
    }
  }

  const handleCreate = async (params: CreateAlertParams) => {
    try {
      const newAlert = await api.createAlert(params)
      setAlerts([newAlert, ...alerts])
      toast.success('Alert created!')
    } catch (err: any) {
      toast.error(err.detail || 'Failed to create alert')
    }
  }

  const activeAlerts = alerts.filter(a => a.isActive && !a.isTriggered)
  const triggeredAlerts = alerts.filter(a => a.isTriggered)

  return (
    <AppLayout 
      header={<AppHeader title="Price Alerts" showBack onBack={() => navigate(-1)} />} 
      activeNav="swap"
    >
      <div className="p-3 pb-20 space-y-4">
        {/* Create Alert Button */}
        <button
          onClick={() => setShowCreate(true)}
          className="w-full py-3 bg-gradient-to-r from-suwappu-magenta-mid to-suwappu-purple-deep text-white font-heading font-semibold rounded-suwappu-xl shadow-suwappu-2 active:scale-[0.98] transition-transform"
        >
          + Create Alert
        </button>

        {/* Loading state */}
        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-suwappu-purple-deep border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-suwappu-text-secondary text-sm">Loading alerts...</p>
          </div>
        )}

        {/* Active Alerts */}
        {!loading && activeAlerts.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-suwappu-text-secondary mb-2">Active Alerts</h3>
            <div className="space-y-3">
              {activeAlerts.map((alert) => (
                <AlertCard 
                  key={alert.id} 
                  alert={alert} 
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        )}

        {/* Triggered Alerts */}
        {!loading && triggeredAlerts.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-suwappu-text-secondary mb-2">Triggered</h3>
            <div className="space-y-3">
              {triggeredAlerts.map((alert) => (
                <AlertCard 
                  key={alert.id} 
                  alert={alert} 
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && alerts.length === 0 && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
              <span className="text-3xl">🔔</span>
            </div>
            <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">
              No alerts yet
            </p>
            <p className="text-xs text-suwappu-text-secondary">
              Create an alert to get notified when prices move
            </p>
          </div>
        )}

        {/* Info Card */}
        <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
          <p className="text-xs text-suwappu-text-secondary">
            💡 <strong>Price Alerts</strong> notify you via Telegram when your target 
            price is reached. Never miss a buying or selling opportunity!
          </p>
        </div>
      </div>

      <CreateAlertModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSave={handleCreate}
      />
    </AppLayout>
  )
}
