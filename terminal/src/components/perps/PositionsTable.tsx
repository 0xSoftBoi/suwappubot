import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { perpsRoutesAvailable } from '../../lib/perpsApi'

// TP/SL editor state, keyed by position id. Held locally — there is no
// /webapp/me/perps/tpsl route yet, so the "Set" action stays gated (disabled +
// tooltip) the same way order execution is. The full UI is built so it's
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

export function PerpsPositions() {
  const { walletAddress, isAuthenticated } = useAuth()
  // Which position's TP/SL editor is open, and the in-progress drafts per id.
  const [openTpSl, setOpenTpSl] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, TpSlDraft>>({})

  const { data: positions, isLoading } = useQuery({
    queryKey: ['perps-positions', walletAddress],
    queryFn: () => api.getPerpsPositions(walletAddress!),
    enabled: isAuthenticated && !!walletAddress,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  const getDraft = (id: string): TpSlDraft => drafts[id] ?? EMPTY_DRAFT
  const updateDraft = (id: string, patch: Partial<TpSlDraft>) =>
    setDrafts(prev => ({ ...prev, [id]: { ...getDraft(id), ...patch } }))

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
        </tr>
      </thead>
      <tbody>
        {positions.map(pos => {
          const draft = getDraft(pos.id)
          const isOpen = openTpSl === pos.id
          return (
            <Fragment key={pos.id}>
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
                <td className="py-2 px-3 text-right font-mono">${pos.markPrice.toFixed(2)}</td>
                <td className={`py-2 px-3 text-right font-mono ${pos.unrealizedPnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                  {pos.unrealizedPnl >= 0 ? '+' : ''}{pos.unrealizedPnl.toFixed(2)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-terminal-text-secondary">
                  ${pos.liquidationPrice.toFixed(2)}
                </td>
                <td className="py-2 px-3 text-right">
                  <button
                    onClick={() => setOpenTpSl(isOpen ? null : pos.id)}
                    data-testid="perps-tpsl-toggle"
                    className={`px-2 py-1 rounded border text-[11px] transition-colors
                      ${isOpen
                        ? 'border-sakura-500 text-sakura-300'
                        : 'border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
                      }`}
                  >
                    TP/SL
                  </button>
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
                  <td colSpan={9} className="py-3 px-3">
                    <div className="grid grid-cols-2 gap-4">
                      {/* Take Profit */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] text-bull font-medium">Take Profit</span>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.takeProfitPrice}
                            onChange={e => updateDraft(pos.id, { takeProfitPrice: e.target.value })}
                            placeholder="Trigger price"
                            data-testid="perps-tp-price"
                            className="terminal-input w-full font-mono text-xs py-1"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.takeProfitPct}
                            onChange={e => updateDraft(pos.id, { takeProfitPct: e.target.value })}
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
                            onChange={e => updateDraft(pos.id, { stopLossPrice: e.target.value })}
                            placeholder="Trigger price"
                            data-testid="perps-sl-price"
                            className="terminal-input w-full font-mono text-xs py-1"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.stopLossPct}
                            onChange={e => updateDraft(pos.id, { stopLossPct: e.target.value })}
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
