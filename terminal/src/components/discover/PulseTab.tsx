import { usePulse } from '../../hooks/usePulse'
import { PulseFilters } from './PulseFilters'
import { PulseTokenRow } from './PulseTokenRow'

const SUB_TABS = [
  { id: 'new' as const, label: 'New Creations' },
  { id: 'final_stretch' as const, label: 'Final Stretch' },
  { id: 'migrated' as const, label: 'Migrated' },
]

export function PulseTab() {
  const { activeStage, setActiveStage, tokens, filters, setFilters, resetFilters, lastUpdated } = usePulse()

  const timeSince = Math.floor((Date.now() - lastUpdated) / 1000)
  const hasBondingCol = activeStage === 'final_stretch'

  return (
    <div className="flex flex-col h-full" data-testid="pulse-tab">
      {/* Sub-tabs */}
      <div className="flex items-center justify-between border-b border-terminal-border px-2 py-1 bg-terminal-bg-secondary/30">
        <div className="flex items-center gap-1">
          {SUB_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveStage(tab.id)}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                activeStage === tab.id
                  ? 'bg-sakura-600/20 text-sakura-400 border border-sakura-600/30'
                  : 'text-terminal-text-muted hover:text-terminal-text hover:bg-terminal-bg-tertiary'
              }`}
              data-testid={`pulse-subtab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1 text-[9px] text-terminal-text-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          {timeSince < 5 ? 'Live' : `${timeSince}s ago`}
        </span>
      </div>

      {/* Filters */}
      <PulseFilters filters={filters} onChange={setFilters} onReset={resetFilters} />

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-terminal-text-muted border-b border-terminal-border sticky top-0 bg-terminal-bg">
              <th className="text-left py-1 px-2 font-medium text-[10px]">Age</th>
              <th className="text-left py-1 px-2 font-medium text-[10px]">Token</th>
              <th className="text-left py-1 px-2 font-medium text-[10px]">Chain</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">MCap</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">Vol</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">5m</th>
              <th className="text-right py-1 px-2 font-medium text-[10px]">Holders</th>
              <th className="text-left py-1 px-2 font-medium text-[10px]">Insiders</th>
              {hasBondingCol && (
                <th className="text-left py-1 px-2 font-medium text-[10px]">Bond%</th>
              )}
              <th className="text-right py-1 px-2 font-medium text-[10px]"></th>
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 ? (
              <tr>
                <td colSpan={hasBondingCol ? 10 : 9} className="text-center text-terminal-text-muted text-sm py-8">
                  No tokens match your filters
                </td>
              </tr>
            ) : (
              tokens.map(token => (
                <PulseTokenRow key={token.address} token={token} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
