import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { perpsApi, perpsRoutesAvailable } from '../../lib/perpsApi'
import type { TpSlIntent } from '../../types/perps'

const EMPTY_DRAFT = (positionId: string): TpSlIntent => ({
  positionId,
  takeProfitPrice: '',
  stopLossPrice: '',
  takeProfitPct: '',
  stopLossPct: '',
})

export function PerpsPositions() {
  const { walletAddress, isAuthenticated } = useAuth()
  // TP/SL write path is gated until /webapp/me/perps/tpsl exists. The editor is
  // fully built so it flips on the moment perpsRoutesAvailable() returns true.
  const routesLive = perpsRoutesAvailable()
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TpSlIntent | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: positions, isLoading } = useQuery({
    queryKey: ['perps-positions', walletAddress],
    queryFn: () => api.getPerpsPositions(walletAddress!),
    enabled: isAuthenticated && !!walletAddress,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  function toggleEditor(positionId: string) {
    setError(null)
    if (openId === positionId) {
      setOpenId(null)
      setDraft(null)
    } else {
      setOpenId(positionId)
      setDraft(EMPTY_DRAFT(positionId))
    }
  }

  async function submitTpSl() {
    if (!routesLive || !draft) return
    setSaving(true)
    setError(null)
    try {
      await perpsApi.setTpSl({
        positionId: draft.positionId,
        takeProfitPrice: draft.takeProfitPrice ? parseFloat(draft.takeProfitPrice) : undefined,
        stopLossPrice: draft.stopLossPrice ? parseFloat(draft.stopLossPrice) : undefined,
        takeProfitPct: draft.takeProfitPct ? parseFloat(draft.takeProfitPct) : undefined,
        stopLossPct: draft.stopLossPct ? parseFloat(draft.stopLossPct) : undefined,
      })
      setOpenId(null)
      setDraft(null)
    } catch (e) {
      setError((e as { detail?: string })?.detail || 'Could not set TP/SL. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm animate-pulse">
        Loading positions...
      </div>
    )
  }

  if (!positions || positions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
        No open positions
      </div>
    )
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-terminal-text-muted border-b border-terminal-border">
          <th className="text-left py-2 px-3 font-medium">Market</th>
          <th className="text-left py-2 px-3 font-medium">Side</th>
          <th className="text-right py-2 px-3 font-medium">Size</th>
          <th className="text-right py-2 px-3 font-medium">Leverage</th>
          <th className="text-right py-2 px-3 font-medium">Entry</th>
          <th className="text-right py-2 px-3 font-medium">Mark</th>
          <th className="text-right py-2 px-3 font-medium">PnL</th>
          <th className="text-right py-2 px-3 font-medium">Liq. Price</th>
          <th className="text-right py-2 px-3 font-medium">TP/SL</th>
        </tr>
      </thead>
      <tbody>
        {positions.map(pos => (
          <Fragment key={pos.id}>
            <tr className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors">
              <td className="py-2 px-3 font-medium text-terminal-text">{pos.market}</td>
              <td className="py-2 px-3">
                <span className={pos.side === 'long' ? 'text-bull' : 'text-bear'}>
                  {pos.side.toUpperCase()}
                </span>
              </td>
              <td className="py-2 px-3 text-right font-mono">{pos.size.toFixed(4)}</td>
              <td className="py-2 px-3 text-right font-mono">{pos.leverage.toFixed(1)}x</td>
              <td className="py-2 px-3 text-right font-mono">${pos.entryPrice.toFixed(2)}</td>
              <td className="py-2 px-3 text-right font-mono">${pos.markPrice.toFixed(2)}</td>
              <td className={`py-2 px-3 text-right font-mono ${pos.unrealizedPnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                {pos.unrealizedPnl >= 0 ? '+' : ''}{pos.unrealizedPnl.toFixed(2)}
              </td>
              <td className="py-2 px-3 text-right font-mono text-terminal-text-secondary">
                ${pos.liquidationPrice.toFixed(2)}
              </td>
              <td className="py-2 px-3 text-right">
                <button
                  onClick={() => toggleEditor(pos.id)}
                  className="px-2 py-1 rounded border border-terminal-border text-terminal-text-secondary hover:text-terminal-text hover:border-sakura-500 transition-colors"
                >
                  {openId === pos.id ? 'Close' : 'TP/SL'}
                </button>
              </td>
            </tr>
            {openId === pos.id && draft && (
              <tr className="bg-terminal-bg">
                <td colSpan={9} className="px-3 py-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-terminal-text-muted uppercase tracking-wide">Take profit ($)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.takeProfitPrice}
                        onChange={e => setDraft({ ...draft, takeProfitPrice: e.target.value })}
                        placeholder={pos.markPrice.toFixed(2)}
                        className="terminal-input w-28 font-mono text-xs"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-terminal-text-muted uppercase tracking-wide">Stop loss ($)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.stopLossPrice}
                        onChange={e => setDraft({ ...draft, stopLossPrice: e.target.value })}
                        placeholder={pos.markPrice.toFixed(2)}
                        className="terminal-input w-28 font-mono text-xs"
                      />
                    </label>
                    <button
                      onClick={submitTpSl}
                      disabled={!routesLive || saving || (!draft.takeProfitPrice && !draft.stopLossPrice)}
                      title={routesLive ? 'Attach TP/SL to this position' : 'TP/SL coming soon — not yet available'}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-sakura-500/80 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Setting…' : routesLive ? 'Set TP/SL' : 'Coming soon'}
                    </button>
                  </div>
                  {!routesLive && (
                    <p className="mt-2 text-[11px] text-terminal-text-muted">
                      TP/SL order routing is under development. You can stage values now; they&apos;ll
                      submit once the feature is live.
                    </p>
                  )}
                  {error && <p className="mt-2 text-[11px] text-bear">{error}</p>}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
