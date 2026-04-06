import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AppLayout, AppHeader } from '../components/layout'
import { api, type CreateDCAParams } from '../lib/api'

const INTERVALS = [
  { label: 'Hourly', value: 60 },
  { label: 'Every 6h', value: 360 },
  { label: 'Every 12h', value: 720 },
  { label: 'Daily', value: 1440 },
  { label: 'Weekly', value: 10080 },
]

const CHAINS = [
  { label: 'Solana', value: 'solana' },
  { label: 'Ethereum', value: 'ethereum' },
  { label: 'Base', value: 'base' },
  { label: 'Arbitrum', value: 'arbitrum' },
]

export function DCACreate() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  const [chain, setChain] = useState('solana')
  const [fromToken, setFromToken] = useState('SOL')
  const [toToken, setToToken] = useState('')
  const [amount, setAmount] = useState('')
  const [interval, setInterval] = useState(1440)
  const [totalExecutions, setTotalExecutions] = useState('')

  const handleSubmit = async () => {
    if (!toToken.trim()) {
      toast.error('Enter a target token')
      return
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter a valid amount')
      return
    }

    setSubmitting(true)
    try {
      const params: CreateDCAParams = {
        walletId: 0, // Server resolves from auth context
        fromChain: chain,
        fromToken: chain === 'solana' ? 'SOL' : 'ETH',
        fromTokenSymbol: fromToken,
        toChain: chain,
        toToken: toToken.trim(),
        toTokenSymbol: toToken.trim().toUpperCase(),
        amountPerExecution: amount,
        intervalMinutes: interval,
        ...(totalExecutions ? { totalExecutions: parseInt(totalExecutions) } : {}),
      }

      await api.createDCAOrder(params)
      toast.success('DCA order created!')
      navigate('/dca')
    } catch (e: any) {
      toast.error(e.message || 'Failed to create DCA order')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppLayout>
      <AppHeader title="Create DCA Order" showBack />

      <div className="p-4 space-y-4">
        {/* Chain selector */}
        <div>
          <label className="block text-xs font-medium text-suwappu-text-secondary mb-1">Chain</label>
          <div className="flex gap-2">
            {CHAINS.map(c => (
              <button
                key={c.value}
                onClick={() => {
                  setChain(c.value)
                  setFromToken(c.value === 'solana' ? 'SOL' : 'ETH')
                }}
                className={`flex-1 py-2 text-xs font-medium rounded-lg ${
                  chain === c.value
                    ? 'bg-suwappu-primary text-white'
                    : 'bg-gray-100 text-suwappu-text-secondary'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* From token (fixed to native) */}
        <div>
          <label className="block text-xs font-medium text-suwappu-text-secondary mb-1">Spend Token</label>
          <div className="bg-gray-100 rounded-lg p-3 text-sm text-suwappu-text font-medium">
            {fromToken}
          </div>
        </div>

        {/* To token */}
        <div>
          <label className="block text-xs font-medium text-suwappu-text-secondary mb-1">Buy Token</label>
          <input
            type="text"
            value={toToken}
            onChange={e => setToToken(e.target.value)}
            placeholder="e.g. BONK, PEPE, UNI..."
            className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:border-suwappu-primary focus:outline-none"
          />
        </div>

        {/* Amount per execution */}
        <div>
          <label className="block text-xs font-medium text-suwappu-text-secondary mb-1">
            Amount per buy ({fromToken})
          </label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.1"
            step="0.01"
            min="0"
            className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:border-suwappu-primary focus:outline-none"
          />
        </div>

        {/* Interval */}
        <div>
          <label className="block text-xs font-medium text-suwappu-text-secondary mb-1">Frequency</label>
          <div className="grid grid-cols-3 gap-2">
            {INTERVALS.map(i => (
              <button
                key={i.value}
                onClick={() => setInterval(i.value)}
                className={`py-2 text-xs font-medium rounded-lg ${
                  interval === i.value
                    ? 'bg-suwappu-primary text-white'
                    : 'bg-gray-100 text-suwappu-text-secondary'
                }`}
              >
                {i.label}
              </button>
            ))}
          </div>
        </div>

        {/* Total executions (optional) */}
        <div>
          <label className="block text-xs font-medium text-suwappu-text-secondary mb-1">
            Total buys (leave empty for unlimited)
          </label>
          <input
            type="number"
            value={totalExecutions}
            onChange={e => setTotalExecutions(e.target.value)}
            placeholder="Unlimited"
            min="1"
            className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:border-suwappu-primary focus:outline-none"
          />
        </div>

        {/* Summary */}
        {amount && toToken && (
          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-800">
            Buy {toToken.toUpperCase()} with {amount} {fromToken}{' '}
            {INTERVALS.find(i => i.value === interval)?.label.toLowerCase() || `every ${interval}m`}
            {totalExecutions ? ` for ${totalExecutions} times` : ' until cancelled'}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !toToken || !amount}
          className="w-full py-3 rounded-suwappu-xl font-heading font-semibold text-white bg-suwappu-primary hover:bg-suwappu-primary/90 disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create DCA Order'}
        </button>
      </div>
    </AppLayout>
  )
}

export default DCACreate
