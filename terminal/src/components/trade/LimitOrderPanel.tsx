import { useState } from 'react'

export function LimitOrderPanel() {
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [expiry, setExpiry] = useState('24h')

  return (
    <div className="flex flex-col gap-3 mt-3">
      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Limit Price (USD)</label>
        <input
          type="text"
          value={price}
          onChange={e => setPrice(e.target.value)}
          placeholder="0.00"
          className="terminal-input w-full font-mono"
        />
      </div>

      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Amount</label>
        <input
          type="text"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.0"
          className="terminal-input w-full font-mono"
        />
      </div>

      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Expires</label>
        <div className="flex gap-1">
          {['1h', '4h', '24h', '7d', '30d'].map(opt => (
            <button
              key={opt}
              onClick={() => setExpiry(opt)}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors
                ${expiry === opt
                  ? 'bg-sakura-600/20 text-sakura-400 border border-sakura-600'
                  : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
                }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <button className="terminal-button w-full py-3 mt-2 font-semibold" disabled>
        Create Limit Order
      </button>

      <p className="text-xs text-terminal-text-muted text-center">
        Limit orders execute automatically when price conditions are met
      </p>
    </div>
  )
}
