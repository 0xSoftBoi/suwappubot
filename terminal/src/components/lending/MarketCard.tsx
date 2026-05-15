import type { LendingMarket } from '../../types/api'

interface Props {
  market: LendingMarket
}

function formatCompact(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}

function getUtilizationColor(pct: number): string {
  if (pct <= 60) return 'from-[#22c55e] to-[#22c55e]'
  if (pct <= 80) return 'from-[#22c55e] to-[#eab308]'
  return 'from-[#eab308] to-[#ef4444]'
}

export function MarketCard({ market }: Props) {
  const utilPct = Math.min(market.utilization * 100, 100)

  return (
    <div
      className="bg-terminal-bg rounded-lg p-3 border border-terminal-border hover:border-terminal-border-active transition-colors"
      data-testid="lending-market-card"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full bg-terminal-border flex items-center justify-center text-[10px] font-bold text-terminal-text-muted">
          {market.asset.slice(0, 2)}
        </div>
        <span className="text-sm font-semibold text-terminal-text">{market.asset}</span>
        <span className="text-[10px] text-terminal-text-muted ml-auto">{market.chain}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2 text-xs">
        <div>
          <span className="text-terminal-text-muted">Supply APY</span>
          <div className="font-mono font-semibold text-[#22c55e]">
            {(market.supplyAPY * 100).toFixed(2)}%
          </div>
        </div>
        <div>
          <span className="text-terminal-text-muted">Borrow APY</span>
          <div className="font-mono font-semibold text-terminal-text">
            {(market.borrowAPY * 100).toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="mb-2">
        <div className="flex justify-between text-[10px] text-terminal-text-muted mb-0.5">
          <span>Utilization</span>
          <span className="font-mono">{utilPct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 bg-terminal-border rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${getUtilizationColor(utilPct)} transition-all`}
            style={{ width: `${utilPct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <div>
          <span className="text-terminal-text-muted">Supplied</span>
          <div className="font-mono text-terminal-text">{formatCompact(market.totalSupplied)}</div>
        </div>
        <div>
          <span className="text-terminal-text-muted">Borrowed</span>
          <div className="font-mono text-terminal-text">{formatCompact(market.totalBorrowed)}</div>
        </div>
        <div>
          <span className="text-terminal-text-muted">LLTV</span>
          <div className="font-mono text-terminal-text">{(market.lltv * 100).toFixed(0)}%</div>
        </div>
      </div>
    </div>
  )
}
