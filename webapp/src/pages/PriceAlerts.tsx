import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'

interface PriceAlert {
  id: string
  token: string
  chain: string
  targetPrice: string
  currentPrice: string
  condition: 'above' | 'below'
  isActive: boolean
  createdAt: string
  triggeredAt?: string
}

// Stored in localStorage
const ALERTS_KEY = 'suwappu_price_alerts'

function getStoredAlerts(): PriceAlert[] {
  try {
    const stored = localStorage.getItem(ALERTS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveAlerts(alerts: PriceAlert[]) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts))
}

const tokenIcons: Record<string, string> = {
  ETH: 'Ξ',
  SOL: '◎',
  BTC: '₿',
  USDC: '$',
}

function AlertCard({ alert, onToggle, onDelete }: { 
  alert: PriceAlert
  onToggle: (id: string) => void
  onDelete: (id: string) => void 
}) {
  const isTriggered = alert.triggeredAt !== undefined
  const icon = tokenIcons[alert.token] || alert.token[0]
  
  return (
    <div className={`bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 ${!alert.isActive && !isTriggered ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-suwappu-purple-deep text-white flex items-center justify-center text-lg font-bold">
          {icon}
        </div>
        
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <p className="font-heading font-semibold text-sm text-suwappu-text">{alert.token}</p>
            {isTriggered ? (
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
            Alert when price goes <strong>{alert.condition}</strong> ${alert.targetPrice}
          </p>
          
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-suwappu-text-secondary">
              Current: ${alert.currentPrice}
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
  onSave: (alert: Omit<PriceAlert, 'id' | 'createdAt' | 'triggeredAt' | 'currentPrice'>) => void
}) {
  const [token, setToken] = useState('ETH')
  const [targetPrice, setTargetPrice] = useState('')
  const [condition, setCondition] = useState<'above' | 'below'>('above')

  if (!isOpen) return null

  const handleSave = () => {
    if (!targetPrice) return
    onSave({
      token,
      chain: 'ethereum',
      targetPrice,
      condition,
      isActive: true,
    })
    setTargetPrice('')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div 
        className="bg-white w-full max-w-md rounded-t-3xl p-4 pb-8 animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
        
        <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-4">
          Create Price Alert
        </h3>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-suwappu-text-secondary block mb-1">Token</label>
            <select
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full p-3 rounded-suwappu-lg border border-suwappu-sakura-mid/30 text-sm"
            >
              <option value="ETH">ETH - Ethereum</option>
              <option value="SOL">SOL - Solana</option>
              <option value="BTC">BTC - Bitcoin</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-suwappu-text-secondary block mb-1">Condition</label>
            <div className="flex gap-2">
              <button
                onClick={() => setCondition('above')}
                className={`flex-1 py-2 rounded-suwappu-lg text-sm font-medium ${
                  condition === 'above' 
                    ? 'bg-suwappu-magenta-mid text-white' 
                    : 'bg-suwappu-sakura-light text-suwappu-text'
                }`}
              >
                📈 Goes Above
              </button>
              <button
                onClick={() => setCondition('below')}
                className={`flex-1 py-2 rounded-suwappu-lg text-sm font-medium ${
                  condition === 'below' 
                    ? 'bg-suwappu-magenta-mid text-white' 
                    : 'bg-suwappu-sakura-light text-suwappu-text'
                }`}
              >
                📉 Goes Below
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-suwappu-text-secondary block mb-1">Target Price (USD)</label>
            <input
              type="number"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="0.00"
              className="w-full p-3 rounded-suwappu-lg border border-suwappu-sakura-mid/30 text-sm"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={!targetPrice}
            className="w-full py-3 bg-gradient-to-r from-suwappu-magenta-mid to-suwappu-purple-deep text-white font-heading font-semibold rounded-suwappu-xl disabled:opacity-50"
          >
            Create Alert
          </button>
        </div>
      </div>
    </div>
  )
}

export function PriceAlerts() {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState<PriceAlert[]>(getStoredAlerts)
  const [showCreate, setShowCreate] = useState(false)

  const handleToggle = (id: string) => {
    const updated = alerts.map(a => a.id === id ? { ...a, isActive: !a.isActive } : a)
    setAlerts(updated)
    saveAlerts(updated)
  }

  const handleDelete = (id: string) => {
    const updated = alerts.filter(a => a.id !== id)
    setAlerts(updated)
    saveAlerts(updated)
  }

  const handleCreate = (alertData: Omit<PriceAlert, 'id' | 'createdAt' | 'triggeredAt' | 'currentPrice'>) => {
    const newAlert: PriceAlert = {
      ...alertData,
      id: Date.now().toString(),
      currentPrice: alertData.token === 'ETH' ? '3200' : alertData.token === 'SOL' ? '180' : '95000',
      createdAt: new Date().toISOString(),
    }
    const updated = [...alerts, newAlert]
    setAlerts(updated)
    saveAlerts(updated)
  }

  const activeAlerts = alerts.filter(a => a.isActive && !a.triggeredAt)

  return (
    <AppLayout 
      header={<AppHeader title="Price Alerts" showBack onBack={() => navigate(-1)} />} 
      activeNav="home"
    >
      <div className="p-3 pb-20 space-y-4">
        {/* Create Button */}
        <button
          onClick={() => setShowCreate(true)}
          className="w-full py-3 bg-gradient-to-r from-suwappu-magenta-mid to-suwappu-purple-deep text-white font-heading font-semibold rounded-suwappu-xl shadow-suwappu-2 active:scale-[0.98] transition-transform"
        >
          🔔 Create Price Alert
        </button>

        {/* Active Alerts Count */}
        <div className="bg-suwappu-sakura-light/50 rounded-suwappu-lg p-3 flex items-center justify-between">
          <span className="text-sm text-suwappu-text">Active Alerts</span>
          <span className="font-heading font-bold text-suwappu-purple-deep">{activeAlerts.length}</span>
        </div>

        {/* Alerts List */}
        {alerts.length === 0 ? (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
              <span className="text-3xl">🔔</span>
            </div>
            <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">
              No alerts set
            </p>
            <p className="text-xs text-suwappu-text-secondary">
              Get notified when tokens hit your target price
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <AlertCard 
                key={alert.id} 
                alert={alert} 
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {/* Coming Soon Badge */}
        <div className="text-center">
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">
            🚧 Push notifications coming soon
          </span>
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
