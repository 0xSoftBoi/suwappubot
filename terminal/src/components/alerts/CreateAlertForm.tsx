import { useState } from 'react'
import type { AlertType } from '../../types/api'

interface Props {
  onSubmit: (data: { tokenSymbol: string; alertType: AlertType; targetValue: number }) => void
  isLoading: boolean
}

const alertTypes: { value: AlertType; label: string }[] = [
  { value: 'price_above', label: 'Price Above' },
  { value: 'price_below', label: 'Price Below' },
]

export function CreateAlertForm({ onSubmit, isLoading }: Props) {
  const [tokenSymbol, setTokenSymbol] = useState('')
  const [alertType, setAlertType] = useState<AlertType>('price_above')
  const [targetValue, setTargetValue] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!tokenSymbol || !targetValue) return
    onSubmit({
      tokenSymbol: tokenSymbol.toUpperCase(),
      alertType,
      targetValue: parseFloat(targetValue),
    })
    setTokenSymbol('')
    setTargetValue('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="flex-1 min-w-0">
        <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Token</label>
        <input
          type="text"
          value={tokenSymbol}
          onChange={e => setTokenSymbol(e.target.value)}
          placeholder="ETH"
          className="terminal-input text-sm w-full mt-0.5"
        />
      </div>

      <div className="flex-shrink-0">
        <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Type</label>
        <div className="flex gap-1 mt-0.5" role="group" aria-label="Alert type selector">
          {alertTypes.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setAlertType(t.value)}
              className={`px-2 py-1.5 text-[11px] rounded transition-colors ${
                alertType === t.value
                  ? 'bg-sakura/20 text-sakura border border-sakura/40'
                  : 'bg-terminal-bg text-terminal-text-muted border border-terminal-border hover:border-terminal-border-active'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="w-24 flex-shrink-0">
        <label className="text-[10px] text-terminal-text-muted uppercase tracking-wider">Target ($)</label>
        <input
          type="number"
          value={targetValue}
          onChange={e => setTargetValue(e.target.value)}
          placeholder="0.00"
          step="any"
          className="terminal-input text-sm w-full mt-0.5"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading || !tokenSymbol || !targetValue}
        className="terminal-button text-sm px-3 py-1.5 flex-shrink-0 disabled:opacity-50"
      >
        {isLoading ? '...' : 'Create Alert'}
      </button>
    </form>
  )
}
