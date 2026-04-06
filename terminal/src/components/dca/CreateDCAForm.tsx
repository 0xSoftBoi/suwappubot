import { useState, useMemo } from 'react'
import type { DCAFrequency } from '../../types/api'

interface Props {
  onSubmit: (data: {
    fromChain: string
    fromToken: string
    fromTokenSymbol: string
    toChain: string
    toToken: string
    toTokenSymbol: string
    amountPerExecution: string
    frequency: DCAFrequency
    totalExecutions: number
    walletAddress: string
  }) => void
  isLoading: boolean
}

const frequencies: { value: DCAFrequency; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

export function CreateDCAForm({ onSubmit, isLoading }: Props) {
  const [fromChain, setFromChain] = useState('base')
  const [fromToken, setFromToken] = useState('USDC')
  const [toChain, setToChain] = useState('base')
  const [toToken, setToToken] = useState('ETH')
  const [totalAmount, setTotalAmount] = useState('')
  const [frequency, setFrequency] = useState<DCAFrequency>('daily')
  const [numberOfOrders, setNumberOfOrders] = useState('7')
  const [walletAddress, setWalletAddress] = useState('')

  const perOrder = useMemo(() => {
    const total = parseFloat(totalAmount)
    const orders = parseInt(numberOfOrders)
    if (!total || !orders || orders <= 0) return 0
    return total / orders
  }, [totalAmount, numberOfOrders])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!fromToken || !toToken || !totalAmount || !numberOfOrders) return
    onSubmit({
      fromChain,
      fromToken: fromToken.toUpperCase(),
      fromTokenSymbol: fromToken.toUpperCase(),
      toChain,
      toToken: toToken.toUpperCase(),
      toTokenSymbol: toToken.toUpperCase(),
      amountPerExecution: perOrder.toFixed(2),
      frequency,
      totalExecutions: parseInt(numberOfOrders),
      walletAddress,
    })
    setTotalAmount('')
    setNumberOfOrders('7')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">From Chain</label>
          <input
            type="text"
            value={fromChain}
            onChange={e => setFromChain(e.target.value)}
            placeholder="base"
            className="terminal-input text-sm w-full mt-0.5 mb-2"
          />
          <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">From</label>
          <input
            type="text"
            value={fromToken}
            onChange={e => setFromToken(e.target.value)}
            placeholder="USDC"
            className="terminal-input text-sm w-full mt-0.5"
          />
        </div>
        <div className="flex items-end pb-1.5 text-terminal-text-muted text-sm">→</div>
        <div className="flex-1">
          <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">To Chain</label>
          <input
            type="text"
            value={toChain}
            onChange={e => setToChain(e.target.value)}
            placeholder="base"
            className="terminal-input text-sm w-full mt-0.5 mb-2"
          />
          <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">To</label>
          <input
            type="text"
            value={toToken}
            onChange={e => setToToken(e.target.value)}
            placeholder="ETH"
            className="terminal-input text-sm w-full mt-0.5"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Total Amount ($)</label>
          <input
            type="number"
            value={totalAmount}
            onChange={e => setTotalAmount(e.target.value)}
            placeholder="1000"
            step="any"
            className="terminal-input text-sm w-full mt-0.5"
          />
        </div>
        <div className="w-20">
          <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Orders</label>
          <input
            type="number"
            value={numberOfOrders}
            onChange={e => setNumberOfOrders(e.target.value)}
            min="1"
            className="terminal-input text-sm w-full mt-0.5"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Wallet Address</label>
        <input
          type="text"
          value={walletAddress}
          onChange={e => setWalletAddress(e.target.value)}
          placeholder="0x..."
          className="terminal-input text-sm w-full mt-0.5"
        />
      </div>

      <div>
        <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Frequency</label>
        <div className="flex gap-1 mt-0.5" role="radiogroup" aria-label="DCA frequency">
          {frequencies.map(f => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={frequency === f.value}
              onClick={() => setFrequency(f.value)}
              className={`flex-1 px-2 py-1.5 text-[11px] rounded transition-colors ${
                frequency === f.value
                  ? 'bg-sakura/20 text-sakura border border-sakura/40'
                  : 'bg-terminal-bg text-terminal-text-muted border border-terminal-border hover:border-terminal-border-active'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {perOrder > 0 && (
        <div className="text-xs text-terminal-text-muted">
          Per order: <span className="font-mono text-terminal-text">${perOrder.toFixed(2)}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || !fromToken || !toToken || !totalAmount || !numberOfOrders || !walletAddress}
        className="terminal-button text-sm w-full py-2 disabled:opacity-50"
      >
        {isLoading ? 'Creating...' : 'Start DCA'}
      </button>
    </form>
  )
}
