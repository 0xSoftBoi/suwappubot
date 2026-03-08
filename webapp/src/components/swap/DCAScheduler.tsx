import React, { useState, useCallback, useMemo } from 'react'

export interface DCAConfig {
  buyToken: string
  spendToken: string
  amountPerInterval: number
  frequency: 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly'
  totalIntervals: number
}

export interface DCAPosition {
  id: string
  buyToken: string
  spendToken: string
  amountPerInterval: number
  frequency: string
  completedIntervals: number
  totalIntervals: number
  totalSpent: number
  totalReceived: number
  avgPrice: number
  currentPrice: number
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  nextExecution?: string
  createdAt: string
}

export interface DCASchedulerProps {
  positions?: DCAPosition[]
  onCreateDCA?: (config: DCAConfig) => void
  onPauseDCA?: (positionId: string) => void
  onResumeDCA?: (positionId: string) => void
  onCancelDCA?: (positionId: string) => void
  className?: string
}

type Frequency = DCAConfig['frequency']

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const TOKEN_OPTIONS = ['ETH', 'BTC', 'SOL', 'USDC', 'USDT', 'ARB', 'OP', 'MATIC']

function getFrequencyMs(freq: Frequency): number {
  switch (freq) {
    case 'hourly': return 60 * 60 * 1000
    case 'daily': return 24 * 60 * 60 * 1000
    case 'weekly': return 7 * 24 * 60 * 60 * 1000
    case 'biweekly': return 14 * 24 * 60 * 60 * 1000
    case 'monthly': return 30 * 24 * 60 * 60 * 1000
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getScheduleDates(frequency: Frequency, totalIntervals: number, maxShow = 5): Date[] {
  const now = new Date()
  const intervalMs = getFrequencyMs(frequency)
  const count = Math.min(totalIntervals, maxShow)
  const dates: Date[] = []
  for (let i = 1; i <= count; i++) {
    dates.push(new Date(now.getTime() + intervalMs * i))
  }
  return dates
}

function StatusBadge({ status }: { status: DCAPosition['status'] }) {
  const styles: Record<DCAPosition['status'], string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-blue-100 text-blue-700',
    cancelled: 'bg-suwappu-sakura-100/50 text-suwappu-text-secondary',
  }
  return (
    <span className={`px-2 py-0.5 rounded-suwappu-pill text-xs font-medium capitalize ${styles[status]}`}>
      {status}
    </span>
  )
}

function PositionCard({
  position,
  onPause,
  onResume,
  onCancel,
}: {
  position: DCAPosition
  onPause?: (id: string) => void
  onResume?: (id: string) => void
  onCancel?: (id: string) => void
}) {
  const progress = (position.completedIntervals / position.totalIntervals) * 100
  const pnlPercent = position.avgPrice > 0
    ? ((position.currentPrice - position.avgPrice) / position.avgPrice) * 100
    : 0
  const isPositive = pnlPercent >= 0

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-heading font-semibold text-suwappu-text">
            {position.buyToken}/{position.spendToken}
          </span>
          <StatusBadge status={position.status} />
        </div>
        <span className="text-xs text-suwappu-text-secondary capitalize">
          {position.frequency}
        </span>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-suwappu-text-secondary mb-1">
          <span>{position.completedIntervals} of {position.totalIntervals} intervals</span>
          <span>{progress.toFixed(0)}%</span>
        </div>
        <div className="h-2 rounded-suwappu-pill bg-suwappu-sakura-100 overflow-hidden">
          <div
            className="h-full rounded-suwappu-pill bg-suwappu-sakura-300 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Performance */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-xs text-suwappu-text-secondary">Spent</div>
          <div className="text-sm font-semibold text-suwappu-text">
            ${position.totalSpent.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs text-suwappu-text-secondary">Received</div>
          <div className="text-sm font-semibold text-suwappu-text">
            {position.totalReceived.toLocaleString()} {position.buyToken}
          </div>
        </div>
        <div>
          <div className="text-xs text-suwappu-text-secondary">Avg Price</div>
          <div className="text-sm font-semibold text-suwappu-text">
            ${position.avgPrice.toLocaleString()}
          </div>
        </div>
      </div>

      {/* PnL */}
      <div className="flex items-center justify-between px-3 py-2 rounded-suwappu-lg bg-suwappu-sakura-50">
        <span className="text-xs text-suwappu-text-secondary">Current Price</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-suwappu-text">
            ${position.currentPrice.toLocaleString()}
          </span>
          <span className={`text-xs font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {isPositive ? '+' : ''}{pnlPercent.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Next execution */}
      {position.nextExecution && position.status === 'active' && (
        <div className="text-xs text-suwappu-text-secondary">
          Next buy: {formatDate(new Date(position.nextExecution))}
        </div>
      )}

      {/* Controls */}
      {(position.status === 'active' || position.status === 'paused') && (
        <div className="flex gap-2 pt-1">
          {position.status === 'active' && onPause && (
            <button
              type="button"
              onClick={() => onPause(position.id)}
              className="flex-1 px-3 py-1.5 text-sm font-medium rounded-suwappu-pill bg-suwappu-sakura-50 text-suwappu-text hover:bg-suwappu-sakura-100 transition-colors"
            >
              Pause
            </button>
          )}
          {position.status === 'paused' && onResume && (
            <button
              type="button"
              onClick={() => onResume(position.id)}
              className="flex-1 px-3 py-1.5 text-sm font-medium rounded-suwappu-pill bg-suwappu-magenta text-white hover:opacity-90 transition-opacity"
            >
              Resume
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={() => onCancel(position.id)}
              className="px-3 py-1.5 text-sm font-medium rounded-suwappu-pill bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export const DCAScheduler = React.memo(function DCAScheduler({
  positions = [],
  onCreateDCA,
  onPauseDCA,
  onResumeDCA,
  onCancelDCA,
  className = '',
}: DCASchedulerProps) {
  const [buyToken, setBuyToken] = useState('ETH')
  const [spendToken, setSpendToken] = useState('USDC')
  const [amountPerInterval, setAmountPerInterval] = useState<string>('')
  const [frequency, setFrequency] = useState<Frequency>('daily')
  const [totalIntervals, setTotalIntervals] = useState<string>('')
  const [showSchedule, setShowSchedule] = useState(false)

  const parsedAmount = parseFloat(amountPerInterval) || 0
  const parsedIntervals = parseInt(totalIntervals, 10) || 0
  const totalInvestment = parsedAmount * parsedIntervals

  const scheduleDates = useMemo(
    () => (parsedIntervals > 0 ? getScheduleDates(frequency, parsedIntervals) : []),
    [frequency, parsedIntervals],
  )

  const handleCreate = useCallback(() => {
    if (parsedAmount <= 0 || parsedIntervals <= 0 || buyToken === spendToken) return
    onCreateDCA?.({
      buyToken,
      spendToken,
      amountPerInterval: parsedAmount,
      frequency,
      totalIntervals: parsedIntervals,
    })
  }, [buyToken, spendToken, parsedAmount, frequency, parsedIntervals, onCreateDCA])

  const canCreate = parsedAmount > 0 && parsedIntervals > 0 && buyToken !== spendToken

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Create DCA Form */}
      <div className="bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 p-4 space-y-4">
        <h3 className="font-heading font-semibold text-suwappu-text text-lg">
          DCA Scheduler
        </h3>

        {/* Token pair selection */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-suwappu-text-secondary mb-1">Buy Token</label>
            <select
              value={buyToken}
              onChange={(e) => setBuyToken(e.target.value)}
              className="w-full px-3 py-2 rounded-suwappu-lg border border-suwappu-sakura-200/40 bg-suwappu-sakura-50 text-suwappu-text text-sm font-medium outline-none focus:border-suwappu-magenta transition-colors"
            >
              {TOKEN_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-suwappu-text-secondary mb-1">Spend Token</label>
            <select
              value={spendToken}
              onChange={(e) => setSpendToken(e.target.value)}
              className="w-full px-3 py-2 rounded-suwappu-lg border border-suwappu-sakura-200/40 bg-suwappu-sakura-50 text-suwappu-text text-sm font-medium outline-none focus:border-suwappu-magenta transition-colors"
            >
              {TOKEN_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {buyToken === spendToken && (
          <div className="text-xs text-red-500">Buy and spend tokens must be different</div>
        )}

        {/* Amount per interval */}
        <div>
          <label className="block text-xs text-suwappu-text-secondary mb-1">
            Amount per interval ({spendToken})
          </label>
          <input
            type="number"
            min="0"
            step="any"
            value={amountPerInterval}
            onChange={(e) => setAmountPerInterval(e.target.value)}
            placeholder="100"
            className="w-full px-3 py-2 rounded-suwappu-lg border border-suwappu-sakura-200/40 bg-suwappu-sakura-50 text-suwappu-text text-sm outline-none focus:border-suwappu-magenta transition-colors"
          />
        </div>

        {/* Frequency selector */}
        <div>
          <label className="block text-xs text-suwappu-text-secondary mb-2">Frequency</label>
          <div className="flex flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFrequency(f.value)}
                className={`px-3 py-1.5 rounded-suwappu-pill text-sm font-medium transition-colors ${
                  frequency === f.value
                    ? 'bg-suwappu-magenta text-white'
                    : 'bg-suwappu-sakura-50 text-suwappu-text hover:bg-suwappu-sakura-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Total intervals */}
        <div>
          <label className="block text-xs text-suwappu-text-secondary mb-1">
            Number of intervals
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={totalIntervals}
            onChange={(e) => setTotalIntervals(e.target.value)}
            placeholder="30"
            className="w-full px-3 py-2 rounded-suwappu-lg border border-suwappu-sakura-200/40 bg-suwappu-sakura-50 text-suwappu-text text-sm outline-none focus:border-suwappu-magenta transition-colors"
          />
        </div>

        {/* Total investment summary */}
        {totalInvestment > 0 && (
          <div className="px-3 py-2 rounded-suwappu-lg bg-suwappu-sakura-50 text-sm">
            <div className="flex justify-between text-suwappu-text-secondary">
              <span>Total investment</span>
              <span className="font-semibold text-suwappu-text">
                {totalInvestment.toLocaleString()} {spendToken}
              </span>
            </div>
          </div>
        )}

        {/* Schedule preview toggle */}
        {scheduleDates.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowSchedule(!showSchedule)}
              className="flex items-center gap-1.5 text-xs text-suwappu-magenta font-medium hover:underline"
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform ${showSchedule ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {showSchedule ? 'Hide' : 'Show'} upcoming dates
            </button>

            {showSchedule && (
              <div className="mt-2 space-y-1">
                {scheduleDates.map((date, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-suwappu-text-secondary px-2 py-1"
                  >
                    <div className="w-1.5 h-1.5 rounded-suwappu-pill bg-suwappu-sakura-300" />
                    <span>
                      Buy #{i + 1} — {formatDate(date)}
                    </span>
                    <span className="ml-auto font-medium text-suwappu-text">
                      {parsedAmount} {spendToken}
                    </span>
                  </div>
                ))}
                {parsedIntervals > scheduleDates.length && (
                  <div className="text-xs text-suwappu-text-secondary px-2 py-1 italic">
                    ...and {parsedIntervals - scheduleDates.length} more
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Create button */}
        <button
          type="button"
          onClick={handleCreate}
          disabled={!canCreate}
          className={`w-full py-2.5 rounded-suwappu-pill text-sm font-semibold transition-all ${
            canCreate
              ? 'bg-suwappu-magenta text-white hover:opacity-90 active:scale-[0.98]'
              : 'bg-suwappu-sakura-100 text-suwappu-text-secondary cursor-not-allowed'
          }`}
        >
          Create DCA Schedule
        </button>
      </div>

      {/* Active positions */}
      {positions.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-heading font-semibold text-suwappu-text text-sm px-1">
            Your DCA Positions
          </h4>
          {positions.map((pos) => (
            <PositionCard
              key={pos.id}
              position={pos}
              onPause={onPauseDCA}
              onResume={onResumeDCA}
              onCancel={onCancelDCA}
            />
          ))}
        </div>
      )}
    </div>
  )
})
