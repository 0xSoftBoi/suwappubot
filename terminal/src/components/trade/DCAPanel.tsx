import { useState } from 'react'

export function DCAPanel() {
  const [totalAmount, setTotalAmount] = useState('')
  const [frequency, setFrequency] = useState('daily')
  const [numOrders, setNumOrders] = useState('7')

  return (
    <div className="flex flex-col gap-3 mt-3">
      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Total Amount (USD)</label>
        <input
          type="text"
          value={totalAmount}
          onChange={e => setTotalAmount(e.target.value)}
          placeholder="100.00"
          className="terminal-input w-full font-mono"
        />
      </div>

      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Frequency</label>
        <div className="flex gap-1">
          {[
            { id: 'hourly', label: 'Hourly' },
            { id: 'daily', label: 'Daily' },
            { id: 'weekly', label: 'Weekly' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setFrequency(opt.id)}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors
                ${frequency === opt.id
                  ? 'bg-sakura-600/20 text-sakura-400 border border-sakura-600'
                  : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
                }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Number of Orders</label>
        <input
          type="number"
          value={numOrders}
          onChange={e => setNumOrders(e.target.value)}
          min="2"
          max="365"
          className="terminal-input w-full font-mono"
        />
      </div>

      {totalAmount && numOrders && (
        <div className="bg-terminal-bg rounded px-3 py-2 text-xs text-terminal-text-secondary">
          <span className="font-mono text-terminal-text">
            ${(parseFloat(totalAmount || '0') / parseInt(numOrders || '1')).toFixed(2)}
          </span>{' '}
          per {frequency} order &times; {numOrders} orders
        </div>
      )}

      <button
        className="terminal-button w-full py-3 mt-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        disabled
        title="Dollar-cost averaging schedules are coming soon"
      >
        Schedule DCA
      </button>
      <p className="text-center text-[11px] text-terminal-text-muted">
        Automated DCA schedules are coming soon.
      </p>
    </div>
  )
}
