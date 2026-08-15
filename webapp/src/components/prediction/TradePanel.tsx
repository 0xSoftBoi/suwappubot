import { useState } from 'react'
import type { PredictionMarket } from '../../types/prediction'

interface TradePanelProps {
  market: PredictionMarket
}

export function TradePanel({ market }: TradePanelProps) {
  const [selectedOutcome, setSelectedOutcome] = useState(0)
  const [amount, setAmount] = useState('')

  const price = parseFloat(market.outcomePrices[selectedOutcome] || '0.5')
  const amountNum = parseFloat(amount) || 0
  const shares = amountNum > 0 && price > 0 ? amountNum / price : 0
  const payout = shares * 1 // $1 per share if correct

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Trade</span>
        <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
          Coming Soon
        </span>
      </div>

      {/* Outcome toggle */}
      <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
        {market.outcomes.map((outcome, i) => (
          <button
            key={i}
            onClick={() => setSelectedOutcome(i)}
            className={`flex-1 py-2 rounded-md text-xs font-medium transition-colors ${
              selectedOutcome === i
                ? i === 0
                  ? 'bg-green-500 text-white'
                  : 'bg-red-500 text-white'
                : 'text-suwappu-text-secondary'
            }`}
          >
            {outcome} ({(parseFloat(market.outcomePrices[i] || '0') * 100).toFixed(0)}%)
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div>
        <label className="block text-[10px] text-suwappu-text-secondary mb-1">Amount (USDC)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          disabled
          className="w-full p-2.5 rounded-lg border border-gray-200 text-sm bg-gray-50 text-suwappu-text-secondary"
        />
      </div>

      {/* Preview */}
      {amountNum > 0 && (
        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-suwappu-text-secondary">
            <span>Price per share</span>
            <span className="font-mono">${price.toFixed(3)}</span>
          </div>
          <div className="flex justify-between text-suwappu-text-secondary">
            <span>Est. shares</span>
            <span className="font-mono">{shares.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-medium text-suwappu-text">
            <span>Potential payout</span>
            <span className="font-mono text-green-600">${payout.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        disabled
        className="w-full py-3 rounded-xl font-heading font-semibold text-sm bg-gray-200 text-gray-400 cursor-not-allowed"
      >
        Trading Coming Soon
      </button>

      <p className="text-[10px] text-center text-suwappu-text-secondary">
        Order execution depends on Workstream A integration
      </p>
    </div>
  )
}
