import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import type { HLMarket, TerminalPerpsPosition } from '../../types/api'
import { useAuth } from '../../contexts/AuthContext'
import { useTerminalPerpsPositions, useClosePerps } from '../../hooks/useTerminalPerps'
import { perpsRoutesAvailable } from '../../lib/perpsApi'

const CLOSE_STEPS = [25, 50, 100]

// Number of columns in the positions table — drives the inline editor's colSpan.
const COL_COUNT = 10

// TP/SL editor state, keyed by row. Held locally — there is no
// /webapp/me/perps/tpsl route yet, so the "Set" action stays gated (disabled +
// tooltip) the same honest way order execution is. The full UI is built so it's
// drop-in ready once the route lands.
interface TpSlDraft {
  takeProfitPrice: string
  stopLossPrice: string
  takeProfitPct: string
  stopLossPct: string
}

const EMPTY_DRAFT: TpSlDraft = {
  takeProfitPrice: '',
  stopLossPrice: '',
  takeProfitPct: '',
  stopLossPct: '',
}

const TPSL_DISABLED_TOOLTIP = 'TP/SL coming soon — not yet available'

// Live perp positions for the signed-in user. Mark price is overlaid from the
// live markets feed (the HL open-positions endpoint doesn't return a mark), so
// PnL/mark stay fresh. Each row can be closed 25/50/100% and has an inline
// TP/SL editor.
export function PerpsPositions() {
  const { isAuthenticated } = useAuth()
  const { data: positions, isLoading } = useTerminalPerpsPositions()
  const close = useClosePerps()
  const [closingId, setClosingId] = useState<number | null>(null)

  // Which row's TP/SL editor is open, and the in-progress drafts per row.
  const [openTpSl, setOpenTpSl] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, TpSlDraft>>({})
  const getDraft = (key: string): TpSlDraft => drafts[key] ?? EMPTY_DRAFT
  const updateDraft = (key: string, patch: Partial<TpSlDraft>) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...getDraft(key), ...patch } }))

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
    <table className="w-full text-xs" data-testid="perps-positions-table">
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
          <th className="text-right py-2 px-3 font-medium">Close</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((pos) => {
          const mark = markFor(pos)
          const pnl = pnlFor(pos)
          const closeable = pos.id != null
          const busy = closingId === pos.id && close.isPending
          const rowKey = pos.id != null ? String(pos.id) : `${pos.market}-${pos.side}`
          const isOpen = openTpSl === rowKey
          const draft = getDraft(rowKey)
          return (
            <Fragment key={rowKey}>
              <tr
                className="border-b border-terminal-border/50 hover:bg-terminal-bg-tertiary/50 transition-colors"
                data-testid="perps-position-row"
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
                <td className="py-2 px-3 text-right">
                  <button
                    onClick={() => setOpenTpSl(isOpen ? null : rowKey)}
                    data-testid="perps-tpsl-toggle"
                    className={`px-2 py-1 rounded border text-[11px] transition-colors
                      ${
                        isOpen
                          ? 'border-sakura-500 text-sakura-500'
                          : 'border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
                      }`}
                  >
                    TP/SL
                  </button>
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

              {/* Inline TP/SL editor row. Full UI; the "Set" action is gated the
                  same honest way execution is — disabled with a clear tooltip
                  while /webapp/me/perps/tpsl does not exist. */}
              {isOpen && (
                <tr
                  className="border-b border-terminal-border/50 bg-terminal-bg/40"
                  data-testid="perps-tpsl-editor"
                >
                  <td colSpan={COL_COUNT} className="py-3 px-3">
                    <div className="grid grid-cols-2 gap-4">
                      {/* Take Profit */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] text-bull font-medium">Take Profit</span>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.takeProfitPrice}
                            onChange={(e) => updateDraft(rowKey, { takeProfitPrice: e.target.value })}
                            placeholder="Trigger price"
                            data-testid="perps-tp-price"
                            className="terminal-input w-full font-mono text-xs py-1"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.takeProfitPct}
                            onChange={(e) => updateDraft(rowKey, { takeProfitPct: e.target.value })}
                            placeholder="% size"
                            data-testid="perps-tp-pct"
                            className="terminal-input w-20 font-mono text-xs py-1"
                          />
                        </div>
                      </div>

                      {/* Stop Loss */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] text-bear font-medium">Stop Loss</span>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.stopLossPrice}
                            onChange={(e) => updateDraft(rowKey, { stopLossPrice: e.target.value })}
                            placeholder="Trigger price"
                            data-testid="perps-sl-price"
                            className="terminal-input w-full font-mono text-xs py-1"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.stopLossPct}
                            onChange={(e) => updateDraft(rowKey, { stopLossPct: e.target.value })}
                            placeholder="% size"
                            data-testid="perps-sl-pct"
                            className="terminal-input w-20 font-mono text-xs py-1"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-3">
                      <span className="text-[10px] text-terminal-text-muted mr-auto">
                        Defaults to 100% of position if % size is blank.
                      </span>
                      <button
                        onClick={() => setOpenTpSl(null)}
                        data-testid="perps-tpsl-cancel"
                        className="px-3 py-1 rounded border border-terminal-border text-[11px] text-terminal-text-secondary hover:text-terminal-text transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={!perpsRoutesAvailable()}
                        title={perpsRoutesAvailable() ? undefined : TPSL_DISABLED_TOOLTIP}
                        data-testid="perps-tpsl-set"
                        className="px-3 py-1 rounded text-[11px] font-semibold bg-sakura-500/30 text-white cursor-not-allowed opacity-50 transition-colors"
                      >
                        Coming soon — set TP/SL
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
