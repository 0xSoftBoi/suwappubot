import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { usePredictionPositions, useRedeemPrediction } from '../../hooks/useTerminalPredict'

// The signed-in user's Polymarket holdings. Resolved winners are surfaced as a
// "Claimable" row with a Redeem button that redeems on-chain for pUSD; PnL
// refreshes from the predict_monitor service.
export function PredictPositions() {
  const { isAuthenticated } = useAuth()
  const { data: positions, isLoading } = usePredictionPositions()
  const redeem = useRedeemPrediction()
  const [redeemingId, setRedeemingId] = useState<string | null>(null)

  async function doRedeem(positionId: number) {
    setRedeemingId(String(positionId))
    try {
      const res = await redeem.mutateAsync(positionId)
      if (res.ok) {
        toast.success(res.message || 'Redeemed to pUSD on Polygon')
      } else if (res.pending) {
        toast(res.message || 'Redeem submitted — confirming on Polygon', { icon: '⏳' })
      } else {
        toast.error(res.message || 'Could not redeem')
      }
    } catch (e) {
      toast.error((e as { detail?: string })?.detail || 'Could not redeem')
    } finally {
      setRedeemingId(null)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-terminal-text-muted">
        Sign in to view your positions
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-terminal-text-muted animate-pulse">
        Loading positions…
      </div>
    )
  }

  if (!positions || positions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-terminal-text-muted">
        No prediction positions
      </div>
    )
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-terminal-border text-terminal-text-muted">
          <th className="px-3 py-2 text-left font-medium">Market</th>
          <th className="px-3 py-2 text-left font-medium">Outcome</th>
          <th className="px-3 py-2 text-right font-medium">Shares</th>
          <th className="px-3 py-2 text-right font-medium">Avg</th>
          <th className="px-3 py-2 text-right font-medium">Now</th>
          <th className="px-3 py-2 text-right font-medium">PnL</th>
          <th className="px-3 py-2 text-right font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr
            key={p.id}
            className="border-b border-terminal-border/50 transition-colors hover:bg-terminal-bg-tertiary/50"
          >
            <td className="max-w-[280px] truncate px-3 py-2 text-terminal-text" title={p.question}>
              {p.question}
              {p.claimable && (
                <span className="ml-2 rounded bg-bull-dim px-1.5 py-0.5 text-[10px] font-semibold text-bull">
                  Claimable
                </span>
              )}
            </td>
            <td className="px-3 py-2 text-terminal-text-secondary">{p.outcome}</td>
            <td className="px-3 py-2 text-right font-mono">{(p.shares ?? 0).toFixed(1)}</td>
            <td className="px-3 py-2 text-right font-mono">{((p.avgPrice ?? 0) * 100).toFixed(0)}¢</td>
            <td className="px-3 py-2 text-right font-mono">{((p.currentPrice ?? 0) * 100).toFixed(0)}¢</td>
            <td
              className={`px-3 py-2 text-right font-mono ${(p.unrealizedPnl ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}
            >
              {(p.unrealizedPnl ?? 0) >= 0 ? '+' : ''}
              {(p.unrealizedPnl ?? 0).toFixed(2)}
            </td>
            <td className="px-3 py-2 text-right">
              {p.claimable && (
                <button
                  onClick={() => doRedeem(Number(p.id))}
                  disabled={redeem.isPending && redeemingId === p.id}
                  className="rounded bg-bull px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Redeem your winning shares for pUSD on Polygon (needs a little MATIC for gas)"
                >
                  {redeem.isPending && redeemingId === p.id ? 'Redeeming…' : 'Redeem'}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
