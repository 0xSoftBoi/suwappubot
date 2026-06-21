import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import type { HLMarket, TerminalPerpsPosition } from '../../types/api'
import { useAuth } from '../../contexts/AuthContext'
import { useTerminalPerpsPositions, useClosePerps } from '../../hooks/useTerminalPerps'

const CLOSE_STEPS = [25, 50, 100]

// Live perp positions for the signed-in user. Mark price is overlaid from the
// live markets feed (the HL open-positions endpoint doesn't return a mark), so
// PnL/mark stay fresh. Each row can be closed 25/50/100%.
export function PerpsPositions() {
  const { isAuthenticated } = useAuth()
  const { data: positions, isLoading } = useTerminalPerpsPositions()
  const close = useClosePerps()
  const [closingId, setClosingId] = useState<number | null>(null)

  // Live marks to overlay onto positions (backend returns mark == entry).
  const { data: markets } = useQuery({
    queryKey: ['perps-markets'],
    queryFn: () => api.getPerpsMarkets(),
    enabled: isAuthenticated,
    staleTime: 15_000,
  })

  function markFor(pos: TerminalPerpsPosition): number {
    const m = markets?.find((mk: HLMarket) => mk.name === pos.market)
    return m?.markPrice || pos.markPrice
  }

  // Recompute unrealized PnL from the live mark so it doesn't look stale.
  function pnlFor(pos: TerminalPerpsPosition): number {
    const mark = markFor(pos)
    if (!mark || !pos.entryPrice) return pos.unrealizedPnl
    const dir = pos.side === 'long' ? 1 : -1
    return dir * (mark - pos.entryPrice) * pos.size
  }

  async function doClose(positionId: number, percent: number) {
    setClosingId(positionId)
    try {
      await close.mutateAsync({ positionId, percent })
      toast.success(percent === 100 ? 'Position closed' : `Closed ${percent}%`)
    } catch (e) {
      toast.error((e as { detail?: string })?.detail || 'Could not close position')
    } finally {
      setClosingId(null)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-text-muted text-sm">
        Sign in to view your positions
      </div>
    )
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
          <th className="text-right py-2 px-3 font-medium">Close</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((pos) => {
          const mark = markFor(pos)
          const pnl = pnlFor(pos)
          const closeable = pos.id != null
          const busy = closingId === pos.id && close.isPending
          return (
            <tr
              key={pos.id ?? `${pos.market}-${pos.side}`}
              className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors"
            >
              <td className="py-2 px-3 font-medium text-terminal-text">{pos.market}</td>
              <td className="py-2 px-3">
                <span className={pos.side === 'long' ? 'text-bull' : 'text-bear'}>
                  {pos.side.toUpperCase()}
                </span>
              </td>
              <td className="py-2 px-3 text-right font-mono">{pos.size.toFixed(4)}</td>
              <td className="py-2 px-3 text-right font-mono">{pos.leverage.toFixed(1)}x</td>
              <td className="py-2 px-3 text-right font-mono">${pos.entryPrice.toFixed(2)}</td>
              <td className="py-2 px-3 text-right font-mono">${mark.toFixed(2)}</td>
              <td
                className={`py-2 px-3 text-right font-mono ${pnl >= 0 ? 'text-bull' : 'text-bear'}`}
              >
                {pnl >= 0 ? '+' : ''}
                {pnl.toFixed(2)}
              </td>
              <td className="py-2 px-3 text-right font-mono text-terminal-text-secondary">
                ${pos.liquidationPrice.toFixed(2)}
              </td>
              <td className="py-2 px-3">
                {closeable ? (
                  <div className="flex items-center justify-end gap-1">
                    {CLOSE_STEPS.map((pct) => (
                      <button
                        key={pct}
                        onClick={() => doClose(pos.id as number, pct)}
                        disabled={busy}
                        className="px-1.5 py-1 rounded border border-terminal-border text-[10px] text-terminal-text-secondary hover:text-terminal-text hover:border-bear transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? '…' : pct === 100 ? 'Close' : `${pct}%`}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span
                    className="block text-right text-[10px] text-terminal-text-muted"
                    title="Opened outside Suwappu — manage on HyperLiquid"
                  >
                    external
                  </span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
