import { useMemo, useState } from 'react'
import { usePortfolio } from '../../hooks/usePortfolio'
import { useSwaps } from '../../hooks/useSwaps'
import type { TerminalSwap } from '../../types/api'
import { TerminalSkeleton } from '../foundation'
import { PnlShareCard } from './PnlShareCard'

const DAY_MS = 24 * 60 * 60 * 1000

interface RealizedPnl {
  usd: number
  percent: number | null
  tradeCount: number
}

// Realized PnL per swap = proceeds (toAmountUsd) minus cost (fromAmountUsd).
// This mirrors the api-ts /webapp/me/portfolio/pnl formula minus gas/bridge
// fees, which aren't exposed on the TerminalSwap the client already fetches.
function swapPnlUsd(swap: TerminalSwap): number {
  return (swap.toAmountUsd ?? 0) - (swap.fromAmountUsd ?? 0)
}

function isPriced(swap: TerminalSwap): boolean {
  return swap.status === 'completed' && swap.fromAmountUsd != null && swap.toAmountUsd != null
}

function swapTimeMs(swap: TerminalSwap): number {
  return new Date(swap.completedAt ?? swap.createdAt).getTime()
}

function summarize(swaps: TerminalSwap[]): RealizedPnl {
  const usd = swaps.reduce((sum, s) => sum + swapPnlUsd(s), 0)
  const costBasis = swaps.reduce((sum, s) => sum + (s.fromAmountUsd ?? 0), 0)
  return {
    usd,
    percent: costBasis > 0 ? (usd / costBasis) * 100 : null,
    tradeCount: swaps.length,
  }
}

function formatUsdSigned(value: number): string {
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (value > 0) return `+$${abs}`
  if (value < 0) return `-$${abs}`
  return `$${abs}`
}

function PnlStat({ pnl, isLoading }: { pnl: RealizedPnl | null; isLoading: boolean }) {
  if (isLoading) {
    return <TerminalSkeleton width={64} height={18} className="mx-auto" label="Loading PnL" />
  }
  if (!pnl || pnl.tradeCount === 0) {
    return <span className="text-xs text-terminal-text-muted">Tracking starts with your first trade</span>
  }
  const isUp = pnl.usd > 0
  const isDown = pnl.usd < 0
  const color = isUp ? 'text-bull' : isDown ? 'text-bear' : 'text-terminal-text-secondary'
  const glyph = isUp ? '▲' : isDown ? '▼' : ''
  return (
    <div className={`tnum font-mono text-lg ${color}`}>
      <span aria-hidden="true">{glyph} </span>
      {formatUsdSigned(pnl.usd)}
      {pnl.percent !== null && (
        <span className="ml-1 text-xs text-terminal-text-muted">
          ({pnl.percent > 0 ? '+' : ''}
          {pnl.percent.toFixed(1)}%)
        </span>
      )}
    </div>
  )
}

export function PnLSummary() {
  const { data: portfolio, isLoading: portfolioLoading } = usePortfolio()
  const { data: swaps, isLoading: swapsLoading, isError: swapsError, refetch } = useSwaps()
  const [shareOpen, setShareOpen] = useState(false)

  const priced = useMemo(() => (swaps ?? []).filter(isPriced), [swaps])
  const allTime = useMemo(() => summarize(priced), [priced])
  const last24h = useMemo(
    () => summarize(priced.filter(s => Date.now() - swapTimeMs(s) <= DAY_MS)),
    [priced],
  )

  const totalValue = portfolio
    ? `$${portfolio.totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null

  const canShare = !!portfolio && allTime.tradeCount > 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
          Performance
        </span>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          disabled={!canShare}
          className="terminal-button-secondary flex items-center gap-1 px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Share PnL card"
          title={canShare ? 'Share PnL card' : 'Trade first to unlock sharing'}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342a4.5 4.5 0 100-2.684m0 2.684a4.502 4.502 0 010-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a4.5 4.5 0 108.632-2.658 4.5 4.5 0 00-8.632 2.658zm0 9.316a4.5 4.5 0 108.632 2.658 4.5 4.5 0 00-8.632-2.658z" />
          </svg>
          Share
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="terminal-panel p-3 text-center">
          <div className="terminal-theme-caption mb-1 text-[10px] uppercase text-terminal-text-muted">
            Total Value
          </div>
          <div className="tnum font-mono text-lg text-terminal-text">
            {portfolioLoading ? (
              <TerminalSkeleton width={72} height={18} className="mx-auto" label="Loading portfolio value" />
            ) : (
              totalValue ?? '$0.00'
            )}
          </div>
        </div>
        <div className="terminal-panel p-3 text-center">
          <div className="terminal-theme-caption mb-1 text-[10px] uppercase text-terminal-text-muted">
            24h PnL
          </div>
          {swapsError ? (
            <button
              type="button"
              onClick={() => refetch()}
              className="text-xs text-bear underline decoration-dotted"
            >
              Couldn't load — retry
            </button>
          ) : (
            <PnlStat pnl={last24h} isLoading={swapsLoading} />
          )}
        </div>
        <div className="terminal-panel p-3 text-center">
          <div className="terminal-theme-caption mb-1 text-[10px] uppercase text-terminal-text-muted">
            All-Time PnL
          </div>
          {swapsError ? (
            <button
              type="button"
              onClick={() => refetch()}
              className="text-xs text-bear underline decoration-dotted"
            >
              Couldn't load — retry
            </button>
          ) : (
            <PnlStat pnl={allTime} isLoading={swapsLoading} />
          )}
        </div>
      </div>

      <PnlShareCard
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        totalValueUsd={portfolio?.totalUsdValue ?? 0}
        pnl24hUsd={last24h.tradeCount > 0 ? last24h.usd : null}
        pnl24hPercent={last24h.percent}
        pnlAllTimeUsd={allTime.tradeCount > 0 ? allTime.usd : null}
        pnlAllTimePercent={allTime.percent}
      />
    </div>
  )
}
