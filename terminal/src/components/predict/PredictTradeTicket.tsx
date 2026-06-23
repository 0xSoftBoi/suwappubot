import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { PredictionMarket } from '../../types/api'
import { useAuth } from '../../contexts/AuthContext'
import { usePlacePredictionOrder } from '../../hooks/useTerminalPredict'

// Order ticket for a single prediction market. Pick an outcome, enter a USDC
// amount, buy at the current market price. Posts to /terminal/predict/order,
// which signs + submits through the same Polymarket client the bot uses.
export function PredictTradeTicket({ market }: { market: PredictionMarket | null }) {
  const { isAuthenticated } = useAuth()
  const place = usePlacePredictionOrder()
  const [outcomeIdx, setOutcomeIdx] = useState(0)
  const [amount, setAmount] = useState('')

  // Reset the chosen outcome when the market changes.
  const tokens = market?.tokens ?? []
  const outcomes = market?.outcomes ?? []
  const prices = market?.outcomePrices ?? []

  const selectedToken = tokens[outcomeIdx]
  const price = prices[outcomeIdx] ?? 0
  const amountNum = parseFloat(amount)
  const shares = useMemo(
    () => (price > 0 && amountNum > 0 ? amountNum / price : 0),
    [price, amountNum],
  )

  const canTrade =
    isAuthenticated && !!market && !!selectedToken && price > 0 && amountNum > 0 && !place.isPending

  async function buy() {
    if (!market || !selectedToken || !(amountNum > 0) || !(price > 0)) return
    try {
      const res = await place.mutateAsync({
        // Prefer the on-chain condition id so the position settles on resolution;
        // the backend resolves it from the numeric id as a fallback.
        tokenId: selectedToken.tokenId,
        marketId: market.conditionId || market.id,
        question: market.question,
        outcome: outcomes[outcomeIdx] ?? selectedToken.outcome,
        side: 'BUY',
        amount: amountNum,
        price,
      })
      if (res.ok) {
        toast.success(`Bought ${shares.toFixed(1)} ${selectedToken.outcome} shares`)
        setAmount('')
      } else {
        toast.error(res.error || 'Order rejected')
      }
    } catch (e) {
      toast.error((e as { detail?: string })?.detail || 'Order failed. Try again.')
    }
  }

  if (!market) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-terminal-text-muted">
        Select a market to trade
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-terminal-text leading-snug">{market.question}</h3>
        <p className="mt-1 text-[11px] text-terminal-text-muted">
          Buy shares of an outcome. Each share pays $1 if it resolves true.
        </p>
      </div>

      {/* Outcome selector — one button per tradeable token */}
      <div className="grid grid-cols-2 gap-2">
        {tokens.map((t, i) => {
          const active = i === outcomeIdx
          const p = prices[i] ?? 0
          const bull = i === 0
          return (
            <button
              key={t.tokenId}
              onClick={() => setOutcomeIdx(i)}
              className={`rounded-lg px-2 py-2 text-center transition-colors border
                ${
                  active
                    ? bull
                      ? 'bg-bull-dim border-bull'
                      : 'bg-bear-dim border-bear'
                    : 'bg-terminal-bg border-terminal-border hover:border-terminal-border-active'
                }`}
            >
              <div className="text-xs text-terminal-text-secondary truncate">{t.outcome}</div>
              <div
                className={`text-sm font-mono font-semibold ${bull ? 'text-bull' : 'text-bear'}`}
              >
                {(p * 100).toFixed(0)}¢
              </div>
            </button>
          )
        })}
      </div>

      {/* Amount */}
      <div>
        <label className="mb-1 block text-xs text-terminal-text-secondary">Amount (USDC)</label>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="terminal-input w-full font-mono"
        />
      </div>

      {/* Summary */}
      {amountNum > 0 && price > 0 && (
        <div className="space-y-1.5 rounded-lg bg-terminal-bg p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Price</span>
            <span className="font-mono">{(price * 100).toFixed(1)}¢</span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Est. shares</span>
            <span className="font-mono">{shares.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Max payout</span>
            <span className="font-mono text-bull">${shares.toFixed(2)}</span>
          </div>
        </div>
      )}

      {!isAuthenticated ? (
        <p className="py-2 text-center text-xs text-terminal-text-muted">Sign in to trade.</p>
      ) : (
        <button
          onClick={buy}
          disabled={!canTrade}
          className="w-full rounded py-3 text-sm font-semibold text-white transition-colors bg-sakura-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {place.isPending
            ? 'Placing…'
            : `Buy ${tokens[outcomeIdx]?.outcome ?? 'outcome'}`}
        </button>
      )}
    </div>
  )
}
