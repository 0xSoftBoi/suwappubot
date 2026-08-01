import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { usePredictionPositions, useRedeemPrediction } from '../../hooks/useTerminalPredict'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

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
      <TerminalEmptyState
        className="h-full"
        kicker="Predictions"
        title="Sign in to view your positions"
        description="Your Polymarket holdings show here with average cost, live price and PnL — plus a one-tap Redeem once a market resolves in your favour."
      />
    )
  }

  if (isLoading) {
    return (
      <div className="p-3">
        <TerminalSkeletonRows rows={4} columns={5} label="Loading prediction positions" />
      </div>
    )
  }

  if (!positions || positions.length === 0) {
    return (
      <TerminalEmptyState
        className="h-full"
        kicker="Predictions"
        title="No prediction positions"
        description="Buy shares of an outcome from the ticket and the position lands here — winners surface as Claimable when the market resolves."
      />
    )
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="hairline-b text-terminal-text-muted">
          <th className="terminal-theme-caption px-3 py-2 text-left text-[10px] uppercase">Market</th>
          <th className="terminal-theme-caption px-3 py-2 text-left text-[10px] uppercase">
            Outcome
          </th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">
            Shares
          </th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">Avg</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">Now</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">PnL</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase"></th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr key={p.id} className="hairline-b terminal-row">
            <td className="max-w-[280px] truncate px-3 py-2 text-terminal-text" title={p.question}>
              {p.question}
              {p.claimable && (
                <span className="up-wash ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold text-bull">
                  Claimable
                </span>
              )}
            </td>
            <td className="px-3 py-2 text-terminal-text-secondary">{p.outcome}</td>
            <td className="px-3 py-2 text-right font-mono tnum">{(p.shares ?? 0).toFixed(1)}</td>
            <td className="px-3 py-2 text-right font-mono tnum">
              {((p.avgPrice ?? 0) * 100).toFixed(0)}¢
            </td>
            <td className="px-3 py-2 text-right font-mono tnum">
              {((p.currentPrice ?? 0) * 100).toFixed(0)}¢
            </td>
            <td
              className={`px-3 py-2 text-right font-mono font-semibold tnum ${(p.unrealizedPnl ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}
            >
              <span aria-hidden="true">{(p.unrealizedPnl ?? 0) >= 0 ? '▲' : '▼'}</span>{' '}
              {(p.unrealizedPnl ?? 0) >= 0 ? '+' : '−'}$
              {Math.abs(p.unrealizedPnl ?? 0).toFixed(2)}
            </td>
            <td className="px-3 py-2 text-right">
              {p.claimable && (
                <button
                  onClick={() => doRedeem(Number(p.id))}
                  disabled={redeem.isPending && redeemingId === p.id}
                  className="rounded-terminal-control bg-bull px-2.5 py-1 text-[11px] font-semibold text-terminal-on-accent transition-colors hover:opacity-90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
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
