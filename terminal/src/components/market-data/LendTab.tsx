import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'
import { useMarketDataLendMarkets } from '../../hooks/useMarketDataStore'
import { formatApyPct, formatCompactUsd, formatUtilizationPct } from '../../lib/marketDataFormat'

export function LendTab() {
  const { data, isLoading, isError, error, refetch } = useMarketDataLendMarkets(50)
  const markets = data?.markets ?? []

  if (isError) {
    return (
      <div className="p-3">
        <TerminalEmptyState
          kicker="Load failed"
          title="Couldn't load lending markets"
          description={
            typeof error === 'object' && error && 'detail' in error
              ? String((error as { detail?: string }).detail)
              : "Couldn't reach the market-data lend endpoint."
          }
          action={
            <button className="terminal-button px-3 py-1.5 text-xs" onClick={() => refetch()}>
              Retry
            </button>
          }
        />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-3">
        <TerminalSkeletonRows rows={6} columns={6} />
      </div>
    )
  }

  if (markets.length === 0) {
    return (
      <div className="p-3">
        <TerminalEmptyState
          kicker="No data yet"
          title="No lending rates captured yet"
          description="The capture service hasn't populated this dataset yet — expected before deploy."
        />
      </div>
    )
  }

  return (
    <div className="overflow-auto p-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-terminal-border text-terminal-text-muted">
            <th className="px-2 py-1.5 text-left font-medium">Venue</th>
            <th className="px-2 py-1.5 text-left font-medium">Market</th>
            <th className="px-2 py-1.5 text-right font-medium">Supply APY</th>
            <th className="px-2 py-1.5 text-right font-medium">Borrow APY</th>
            <th className="px-2 py-1.5 text-right font-medium">TVL</th>
            <th className="px-2 py-1.5 text-right font-medium">Utilization</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((m, idx) => (
            <tr
              key={`${m.venue}-${m.market_id}-${idx}`}
              className="border-b border-terminal-border/50 transition-colors hover:bg-terminal-bg-tertiary/50"
            >
              <td className="px-2 py-1.5 text-terminal-text-muted">{m.venue}</td>
              <td className="px-2 py-1.5 font-medium text-terminal-text">
                {m.loan_symbol}
                {m.collateral_symbol ? (
                  <span className="text-terminal-text-muted"> / {m.collateral_symbol}</span>
                ) : null}
              </td>
              <td className="tnum px-2 py-1.5 text-right font-mono text-bull">{formatApyPct(m.supply_apy)}</td>
              <td className="tnum px-2 py-1.5 text-right font-mono text-bear">{formatApyPct(m.borrow_apy)}</td>
              <td className="tnum px-2 py-1.5 text-right font-mono text-terminal-text-secondary">
                {formatCompactUsd(m.tvl)}
              </td>
              <td className="tnum px-2 py-1.5 text-right font-mono text-terminal-text-secondary">
                {formatUtilizationPct(m.utilization)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
