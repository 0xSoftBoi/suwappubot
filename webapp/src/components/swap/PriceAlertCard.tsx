import React, { useState, useCallback, useMemo } from 'react'

export interface PriceAlert {
  id: string
  token: string
  tokenSymbol: string
  currentPrice: number
  targetPrice: number
  condition: 'above' | 'below'
  notifyVia: ('app' | 'telegram')[]
  repeat: boolean
  status: 'active' | 'triggered' | 'expired' | 'paused'
  createdAt: string
  triggeredAt?: string
}

export interface PriceAlertCardProps {
  alerts?: PriceAlert[]
  onCreateAlert?: (alert: Omit<PriceAlert, 'id' | 'status' | 'createdAt'>) => void
  onDeleteAlert?: (alertId: string) => void
  onToggleAlert?: (alertId: string) => void
  className?: string
}

const MOCK_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', price: 3245.67 },
  { symbol: 'BTC', name: 'Bitcoin', price: 62450.0 },
  { symbol: 'SOL', name: 'Solana', price: 148.32 },
  { symbol: 'MATIC', name: 'Polygon', price: 0.87 },
  { symbol: 'ARB', name: 'Arbitrum', price: 1.24 },
]

function Toggle({
  enabled,
  onToggle,
  size = 'default',
}: {
  enabled: boolean
  onToggle: () => void
  size?: 'default' | 'small'
}) {
  const w = size === 'small' ? 'w-9 h-5' : 'w-11 h-6'
  const dot = size === 'small' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  const translate = size === 'small'
    ? (enabled ? 'translate-x-[18px]' : 'translate-x-[3px]')
    : (enabled ? 'translate-x-6' : 'translate-x-1')

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative ${w} rounded-suwappu-pill transition-colors ${
        enabled ? 'bg-suwappu-magenta' : 'bg-suwappu-sakura-200/30'
      }`}
      role="switch"
      aria-checked={enabled}
    >
      <div
        className={`absolute top-[3px] ${dot} rounded-suwappu-pill bg-white shadow transition-transform ${translate}`}
      />
    </button>
  )
}

function StatusBadge({ status }: { status: PriceAlert['status'] }) {
  const styles: Record<PriceAlert['status'], string> = {
    active: 'bg-green-100 text-green-700',
    triggered: 'bg-suwappu-magenta/10 text-suwappu-magenta',
    expired: 'bg-suwappu-sakura-100/50 text-suwappu-text-secondary',
    paused: 'bg-yellow-100 text-yellow-700',
  }

  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-suwappu-pill ${styles[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function PriceLine({
  currentPrice,
  targetPrice,
  condition,
}: {
  currentPrice: number
  targetPrice: number
  condition: 'above' | 'below'
}) {
  const min = Math.min(currentPrice, targetPrice)
  const max = Math.max(currentPrice, targetPrice)
  const range = max - min
  const padding = range * 0.2
  const totalMin = min - padding
  const totalMax = max + padding
  const totalRange = totalMax - totalMin

  const currentPct = ((currentPrice - totalMin) / totalRange) * 100
  const targetPct = ((targetPrice - totalMin) / totalRange) * 100

  return (
    <div className="relative h-8 mt-3 mb-1">
      <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 bg-suwappu-sakura-100/50 rounded-suwappu-pill" />
      {/* Fill between current and target */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 h-1 rounded-suwappu-pill ${
          condition === 'above' ? 'bg-green-200' : 'bg-red-200'
        }`}
        style={{
          left: `${Math.min(currentPct, targetPct)}%`,
          width: `${Math.abs(targetPct - currentPct)}%`,
        }}
      />
      {/* Current price marker */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
        style={{ left: `${currentPct}%` }}
      >
        <div className="w-3 h-3 rounded-suwappu-pill bg-suwappu-text border-2 border-white shadow" />
        <span className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-suwappu-text-secondary whitespace-nowrap">
          Current
        </span>
      </div>
      {/* Target price marker */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
        style={{ left: `${targetPct}%` }}
      >
        <div
          className={`w-3 h-3 rounded-suwappu-pill border-2 border-white shadow ${
            condition === 'above' ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span className={`absolute top-4 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap ${
          condition === 'above' ? 'text-green-500' : 'text-red-500'
        }`}>
          Target
        </span>
      </div>
    </div>
  )
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (price >= 1) return price.toFixed(2)
  return price.toFixed(4)
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const PriceAlertCard = React.memo(function PriceAlertCard({
  alerts = [],
  onCreateAlert,
  onDeleteAlert,
  onToggleAlert,
  className = '',
}: PriceAlertCardProps) {
  const [selectedToken, setSelectedToken] = useState(MOCK_TOKENS[0])
  const [condition, setCondition] = useState<'above' | 'below'>('above')
  const [targetPrice, setTargetPrice] = useState('')
  const [notifyApp, setNotifyApp] = useState(true)
  const [notifyTelegram, setNotifyTelegram] = useState(true)
  const [repeat, setRepeat] = useState(false)
  const [showForm, setShowForm] = useState(true)

  const percentChange = useMemo(() => {
    const target = parseFloat(targetPrice)
    if (!targetPrice || isNaN(target) || target <= 0) return null
    return ((target - selectedToken.price) / selectedToken.price) * 100
  }, [targetPrice, selectedToken.price])

  const handleCreate = useCallback(() => {
    const target = parseFloat(targetPrice)
    if (!targetPrice || isNaN(target) || target <= 0) return

    const notifyVia: ('app' | 'telegram')[] = []
    if (notifyApp) notifyVia.push('app')
    if (notifyTelegram) notifyVia.push('telegram')
    if (notifyVia.length === 0) notifyVia.push('app')

    onCreateAlert?.({
      token: selectedToken.name,
      tokenSymbol: selectedToken.symbol,
      currentPrice: selectedToken.price,
      targetPrice: target,
      condition,
      notifyVia,
      repeat,
    })

    setTargetPrice('')
  }, [targetPrice, selectedToken, condition, notifyApp, notifyTelegram, repeat, onCreateAlert])

  const handlePercentClick = useCallback(
    (pct: number) => {
      const newPrice = selectedToken.price * (1 + pct / 100)
      setTargetPrice(formatPrice(newPrice))
      setCondition(pct > 0 ? 'above' : 'below')
    },
    [selectedToken.price],
  )

  const activeAlerts = alerts.filter((a) => a.status === 'active' || a.status === 'paused')
  const historyAlerts = alerts.filter((a) => a.status === 'triggered' || a.status === 'expired')

  return (
    <div className={`bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 ${className}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <h3 className="font-heading font-semibold text-suwappu-text text-base">Price Alerts</h3>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="text-sm text-suwappu-magenta font-medium hover:text-suwappu-magenta/80 transition-colors"
        >
          {showForm ? 'Hide' : '+ New Alert'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="px-4 pb-4 space-y-4 border-b border-suwappu-sakura-200/20">
          {/* Token selector */}
          <div>
            <label className="block text-xs font-medium text-suwappu-text-secondary mb-1.5">
              Token
            </label>
            <select
              value={selectedToken.symbol}
              onChange={(e) => {
                const token = MOCK_TOKENS.find((t) => t.symbol === e.target.value)
                if (token) {
                  setSelectedToken(token)
                  setTargetPrice('')
                }
              }}
              className="w-full px-3 py-2 rounded-suwappu-xl border border-suwappu-sakura-200/40 bg-suwappu-sakura-light/30 text-sm text-suwappu-text font-medium focus:outline-none focus:ring-2 focus:ring-suwappu-magenta/30"
            >
              {MOCK_TOKENS.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.symbol} — {t.name}
                </option>
              ))}
            </select>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-xs text-suwappu-text-secondary">Current:</span>
              <span className="text-sm font-semibold text-suwappu-text">
                ${formatPrice(selectedToken.price)}
              </span>
            </div>
          </div>

          {/* Condition toggle */}
          <div>
            <label className="block text-xs font-medium text-suwappu-text-secondary mb-1.5">
              Alert when price goes
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCondition('above')}
                className={`flex-1 py-2 rounded-suwappu-xl text-sm font-medium transition-colors ${
                  condition === 'above'
                    ? 'bg-green-500 text-white'
                    : 'bg-suwappu-sakura-light text-suwappu-text hover:bg-suwappu-sakura-light/80'
                }`}
              >
                Above
              </button>
              <button
                type="button"
                onClick={() => setCondition('below')}
                className={`flex-1 py-2 rounded-suwappu-xl text-sm font-medium transition-colors ${
                  condition === 'below'
                    ? 'bg-red-500 text-white'
                    : 'bg-suwappu-sakura-light text-suwappu-text hover:bg-suwappu-sakura-light/80'
                }`}
              >
                Below
              </button>
            </div>
          </div>

          {/* Target price */}
          <div>
            <label className="block text-xs font-medium text-suwappu-text-secondary mb-1.5">
              Target Price (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-suwappu-text-secondary text-sm">$</span>
              <input
                type="number"
                min="0"
                step="any"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder={formatPrice(selectedToken.price)}
                className="w-full pl-7 pr-3 py-2 rounded-suwappu-xl border border-suwappu-sakura-200/40 bg-suwappu-sakura-light/30 text-sm text-suwappu-text font-medium focus:outline-none focus:ring-2 focus:ring-suwappu-magenta/30"
              />
            </div>
            {percentChange !== null && (
              <div className="mt-1 flex items-center gap-1">
                <span
                  className={`text-xs font-medium ${
                    percentChange >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}
                >
                  {percentChange >= 0 ? '+' : ''}
                  {percentChange.toFixed(2)}% from current
                </span>
              </div>
            )}
            {/* Quick percent buttons */}
            <div className="flex gap-1.5 mt-2">
              {[-10, -5, 5, 10].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handlePercentClick(pct)}
                  className={`px-2.5 py-1 rounded-suwappu-pill text-xs font-medium transition-colors ${
                    pct > 0
                      ? 'bg-green-50 text-green-600 hover:bg-green-100'
                      : 'bg-red-50 text-red-600 hover:bg-red-100'
                  }`}
                >
                  {pct > 0 ? '+' : ''}
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Price line visualization */}
          {targetPrice && parseFloat(targetPrice) > 0 && (
            <PriceLine
              currentPrice={selectedToken.price}
              targetPrice={parseFloat(targetPrice)}
              condition={condition}
            />
          )}

          {/* Notification method */}
          <div>
            <label className="block text-xs font-medium text-suwappu-text-secondary mb-2">
              Notify via
            </label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <Toggle enabled={notifyApp} onToggle={() => setNotifyApp(!notifyApp)} size="small" />
                <span className="text-sm text-suwappu-text">In-App</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Toggle enabled={notifyTelegram} onToggle={() => setNotifyTelegram(!notifyTelegram)} size="small" />
                <span className="text-sm text-suwappu-text">Telegram</span>
              </label>
            </div>
          </div>

          {/* Repeat toggle */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-suwappu-text">Repeat</span>
              <p className="text-xs text-suwappu-text-secondary">
                {repeat ? 'Alert triggers every time' : 'One-time alert'}
              </p>
            </div>
            <Toggle enabled={repeat} onToggle={() => setRepeat(!repeat)} />
          </div>

          {/* Create button */}
          <button
            type="button"
            onClick={handleCreate}
            disabled={!targetPrice || parseFloat(targetPrice) <= 0}
            className="w-full py-2.5 rounded-suwappu-xl bg-suwappu-magenta text-white font-medium text-sm transition-all hover:bg-suwappu-magenta/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create Alert
          </button>
        </div>
      )}

      {/* Active alerts */}
      {activeAlerts.length > 0 && (
        <div className="px-4 py-3">
          <h4 className="text-xs font-semibold text-suwappu-text-secondary uppercase tracking-wider mb-2">
            Active Alerts
          </h4>
          <div className="space-y-2">
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 border-l-4 border-l-green-500 px-3 py-2.5"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-suwappu-text">{alert.tokenSymbol}</span>
                    <StatusBadge status={alert.status} />
                    {alert.repeat && (
                      <span className="text-[10px] bg-suwappu-magenta/10 text-suwappu-magenta px-1.5 py-0.5 rounded-suwappu-pill">
                        Recurring
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {onToggleAlert && (
                      <button
                        type="button"
                        onClick={() => onToggleAlert(alert.id)}
                        className="text-xs text-suwappu-text-secondary hover:text-suwappu-text transition-colors"
                        aria-label={alert.status === 'paused' ? 'Resume alert' : 'Pause alert'}
                      >
                        {alert.status === 'paused' ? 'Resume' : 'Pause'}
                      </button>
                    )}
                    {onDeleteAlert && (
                      <button
                        type="button"
                        onClick={() => onDeleteAlert(alert.id)}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                        aria-label="Delete alert"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-suwappu-text-secondary">
                  <span className={alert.condition === 'above' ? 'text-green-500' : 'text-red-500'}>
                    {alert.condition === 'above' ? 'Above' : 'Below'}
                  </span>
                  <span className="font-medium text-suwappu-text">${formatPrice(alert.targetPrice)}</span>
                  <span className="text-suwappu-text-secondary">
                    (current: ${formatPrice(alert.currentPrice)})
                  </span>
                </div>
                <PriceLine
                  currentPrice={alert.currentPrice}
                  targetPrice={alert.targetPrice}
                  condition={alert.condition}
                />
                <div className="flex items-center gap-2 mt-2 text-[10px] text-suwappu-text-secondary">
                  <span>via {alert.notifyVia.join(' + ')}</span>
                  <span>Created {formatDate(alert.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alert history */}
      {historyAlerts.length > 0 && (
        <div className="px-4 py-3 border-t border-suwappu-sakura-200/20">
          <h4 className="text-xs font-semibold text-suwappu-text-secondary uppercase tracking-wider mb-2">
            History
          </h4>
          <div className="space-y-2">
            {historyAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 px-3 py-2.5 ${
                  alert.status === 'triggered'
                    ? 'border-l-4 border-l-suwappu-magenta'
                    : 'border-l-4 border-l-gray-300 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-suwappu-text">{alert.tokenSymbol}</span>
                    <StatusBadge status={alert.status} />
                  </div>
                  {onDeleteAlert && (
                    <button
                      type="button"
                      onClick={() => onDeleteAlert(alert.id)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                      aria-label="Delete alert"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-suwappu-text-secondary">
                  <span className={alert.condition === 'above' ? 'text-green-500' : 'text-red-500'}>
                    {alert.condition === 'above' ? 'Above' : 'Below'}
                  </span>
                  <span className="font-medium text-suwappu-text">${formatPrice(alert.targetPrice)}</span>
                </div>
                {alert.triggeredAt && (
                  <div className="text-[10px] text-suwappu-text-secondary mt-1">
                    Triggered {formatDate(alert.triggeredAt)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {alerts.length === 0 && !showForm && (
        <div className="px-4 pb-4 text-center text-sm text-suwappu-text-secondary">
          No alerts yet. Create one to get notified when prices move.
        </div>
      )}
    </div>
  )
})
