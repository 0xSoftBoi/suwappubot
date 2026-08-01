import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import type { HLMarket, TerminalPerpsPosition } from '../../types/api'
import { useAuth } from '../../contexts/AuthContext'
import { useTerminalPerpsPositions, useClosePerps } from '../../hooks/useTerminalPerps'
import { perpsRoutesAvailable } from '../../lib/perpsApi'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

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
      <TerminalEmptyState
        className="h-full"
        kicker="Perps"
        title="Sign in to view your positions"
        description="Once you're signed in and HyperLiquid is connected, open positions show here with live mark, PnL and liquidation price."
      />
    )
  }

  if (isLoading) {
    return (
      <div className="p-3">
        <TerminalSkeletonRows rows={4} columns={6} label="Loading positions" />
      </div>
    )
  }

  if (!positions || positions.length === 0) {
    return (
      <TerminalEmptyState
        className="h-full"
        kicker="Perps"
        title="No open positions"
        description="Place a long or short from the ticket and it lands here — with live PnL, margin health and one-tap 25 / 50 / 100% closes."
      />
    )
  }

  return (
    <table className="w-full text-xs" data-testid="perps-positions-table">
      <thead>
        <tr className="hairline-b text-terminal-text-muted">
          <th className="terminal-theme-caption px-3 py-2 text-left text-[10px] uppercase">Market</th>
          <th className="terminal-theme-caption px-3 py-2 text-left text-[10px] uppercase">Side</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">Size</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">Lev</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">Entry</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">Mark</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">PnL</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">
            Liq. price
          </th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">TP/SL</th>
          <th className="terminal-theme-caption px-3 py-2 text-right text-[10px] uppercase">Close</th>
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
              <tr className="hairline-b terminal-row" data-testid="perps-position-row">
                <td className="px-3 py-2 font-medium text-terminal-text">{pos.market}</td>
                <td className="px-3 py-2">
                  <span
                    className={`font-mono text-[11px] font-semibold ${pos.side === 'long' ? 'text-bull' : 'text-bear'}`}
                  >
                    <span aria-hidden="true">{pos.side === 'long' ? '▲' : '▼'}</span>{' '}
                    {pos.side.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono tnum">{pos.size.toFixed(4)}</td>
                <td className="px-3 py-2 text-right">
                  <span className="rounded bg-terminal-bg-tertiary/70 px-1.5 py-0.5 font-mono text-[10px] tnum text-terminal-text-secondary">
                    {pos.leverage.toFixed(1)}×
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono tnum">${pos.entryPrice.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono tnum">${mark.toFixed(2)}</td>
                <td
                  className={`px-3 py-2 text-right font-mono font-semibold tnum ${pnl >= 0 ? 'text-bull' : 'text-bear'}`}
                >
                  <span aria-hidden="true">{pnl >= 0 ? '▲' : '▼'}</span> {pnl >= 0 ? '+' : '−'}$
                  {Math.abs(pnl).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-mono tnum text-terminal-text-secondary">
                  ${pos.liquidationPrice.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setOpenTpSl(isOpen ? null : rowKey)}
                    data-testid="perps-tpsl-toggle"
                    aria-expanded={isOpen}
                    className={`rounded-terminal-control border px-2 py-1 text-[11px] transition-colors
                      ${
                        isOpen
                          ? 'accent-wash border-terminal-border-active text-terminal-accent'
                          : 'border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
                      }`}
                  >
                    TP/SL
                  </button>
                </td>
                <td className="px-3 py-2">
                  {closeable ? (
                    <div className="flex items-center justify-end gap-1">
                      {CLOSE_STEPS.map((pct) => (
                        <button
                          key={pct}
                          onClick={() => doClose(pos.id as number, pct)}
                          disabled={busy}
                          className="rounded-terminal-control border border-terminal-border px-1.5 py-1 font-mono text-[10px] tnum text-terminal-text-secondary transition-colors hover:border-bear hover:text-terminal-text disabled:cursor-not-allowed disabled:opacity-50"
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
                <tr className="hairline-b bg-terminal-bg/40" data-testid="perps-tpsl-editor">
                  <td colSpan={COL_COUNT} className="px-3 py-3">
                    <div className="mb-2.5 flex items-center gap-2">
                      <span className="terminal-theme-caption text-[10px] uppercase">
                        TP / SL — {pos.market}
                      </span>
                      {/* §3.6 honesty chip: quiet, non-interactive, no ghost CTA. */}
                      {!perpsRoutesAvailable() && (
                        <span
                          data-testid="perps-tpsl-set"
                          aria-disabled="true"
                          title={TPSL_DISABLED_TOOLTIP}
                          className="hairline rounded-terminal-pill px-2 py-0.5 text-[10px] font-medium text-terminal-text-muted"
                        >
                          In development — ships with the vNEXT backend
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Take Profit */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-medium text-bull">Take Profit</span>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.takeProfitPrice}
                            onChange={(e) => updateDraft(rowKey, { takeProfitPrice: e.target.value })}
                            placeholder="Trigger price"
                            data-testid="perps-tp-price"
                            className="terminal-input w-full py-1 font-mono text-xs tnum"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.takeProfitPct}
                            onChange={(e) => updateDraft(rowKey, { takeProfitPct: e.target.value })}
                            placeholder="% size"
                            data-testid="perps-tp-pct"
                            className="terminal-input w-20 py-1 font-mono text-xs tnum"
                          />
                        </div>
                      </div>

                      {/* Stop Loss */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-medium text-bear">Stop Loss</span>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.stopLossPrice}
                            onChange={(e) => updateDraft(rowKey, { stopLossPrice: e.target.value })}
                            placeholder="Trigger price"
                            data-testid="perps-sl-price"
                            className="terminal-input w-full py-1 font-mono text-xs tnum"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.stopLossPct}
                            onChange={(e) => updateDraft(rowKey, { stopLossPct: e.target.value })}
                            placeholder="% size"
                            data-testid="perps-sl-pct"
                            className="terminal-input w-20 py-1 font-mono text-xs tnum"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-2">
                      <span className="mr-auto text-[10px] text-terminal-text-muted">
                        Draft your levels here — they’ll submit to HyperLiquid once the TP/SL route
                        lands. Blank % size means 100% of the position.
                      </span>
                      <button
                        onClick={() => setOpenTpSl(null)}
                        data-testid="perps-tpsl-cancel"
                        className="rounded-terminal-control border border-terminal-border px-3 py-1 text-[11px] text-terminal-text-secondary transition-colors hover:text-terminal-text"
                      >
                        Hide
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
