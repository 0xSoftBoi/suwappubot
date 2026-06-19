import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { HLMarket } from '../../types/api'
import { usePerpsFunding, formatCountdown, formatFundingPct } from '../../hooks/usePerpsFunding'
import { usePerpsMarginMode } from '../../hooks/usePerpsMarginMode'
import { perpsRoutesAvailable } from '../../lib/perpsApi'

export function PerpsPanel() {
  const [selectedMarket, setSelectedMarket] = useState('ETH-USD')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [size, setSize] = useState('')
  const [leverage, setLeverage] = useState(5)
  const [marginMode, setMarginMode] = usePerpsMarginMode()

  const { data: markets } = useQuery({
    queryKey: ['perps-markets'],
    queryFn: () => api.getPerpsMarkets(),
    staleTime: 30_000,
  })

  const market = markets?.find((m: HLMarket) => m.name === selectedMarket)

  // Real hourly funding rate (HLMarket.fundingRate) + live next-funding countdown
  // derived from HyperLiquid's fixed hourly cadence. Nothing fabricated here.
  const funding = usePerpsFunding(market)

  return (
    <div className="p-4 flex flex-col gap-3" data-testid="perps-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Perpetuals</h3>
        <span className="text-xs text-terminal-text-muted">via HyperLiquid</span>
      </div>

      {/* Market selector */}
      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Market</label>
        <select
          value={selectedMarket}
          onChange={e => setSelectedMarket(e.target.value)}
          className="terminal-input w-full text-sm"
          data-testid="perps-market-select"
        >
          {markets?.map((m: HLMarket) => (
            <option key={m.name} value={m.name}>
              {m.name} — ${m.markPrice.toFixed(2)}
            </option>
          ))}
        </select>
      </div>

      {/* Funding rate + next-funding countdown. Rate is the live HL hourly rate;
          countdown ticks against the next top-of-hour (UTC), when HL funds. */}
      {market && (
        <div
          className="bg-terminal-bg rounded-lg px-3 py-2 flex items-center justify-between text-xs"
          data-testid="perps-funding"
        >
          <div className="flex flex-col">
            <span className="text-terminal-text-muted text-[10px]">Funding / hr</span>
            <span
              className={`font-mono ${funding.hourlyRate >= 0 ? 'text-bull' : 'text-bear'}`}
              data-testid="perps-funding-rate"
            >
              {formatFundingPct(funding.hourlyRate)}
            </span>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-terminal-text-muted text-[10px]">APR (est.)</span>
            <span className="font-mono text-terminal-text-secondary">
              {formatFundingPct(funding.annualizedRate)}
            </span>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-terminal-text-muted text-[10px]">Next funding</span>
            <span className="font-mono" data-testid="perps-funding-countdown">
              {formatCountdown(funding.msUntilNextFunding)}
            </span>
          </div>
        </div>
      )}

      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-1">
        <button
          onClick={() => setSide('long')}
          className={`py-2 rounded text-sm font-semibold transition-colors
            ${side === 'long'
              ? 'bg-bull text-white'
              : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary'
            }`}
        >
          Long
        </button>
        <button
          onClick={() => setSide('short')}
          className={`py-2 rounded text-sm font-semibold transition-colors
            ${side === 'short'
              ? 'bg-bear text-white'
              : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary'
            }`}
        >
          Short
        </button>
      </div>

      {/* Margin mode (cross/isolated). Persisted to localStorage; this is a UI
          preference and is honored once execution lands. */}
      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Margin mode</label>
        <div className="grid grid-cols-2 gap-1" data-testid="perps-margin-toggle">
          {(['cross', 'isolated'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setMarginMode(mode)}
              data-testid={`perps-margin-${mode}`}
              className={`py-1.5 rounded text-xs font-semibold capitalize transition-colors
                ${marginMode === mode
                  ? 'bg-sakura-500/20 border border-sakura-500 text-sakura-300'
                  : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary'
                }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Size */}
      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Size ({market?.asset || '...'})</label>
        <input
          type="text"
          value={size}
          onChange={e => setSize(e.target.value)}
          placeholder="0.0"
          className="terminal-input w-full font-mono"
          data-testid="perps-size-input"
        />
      </div>

      {/* Leverage slider */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <label className="text-xs text-terminal-text-secondary">Leverage</label>
          <span className="text-xs font-mono text-sakura-400">{leverage}x</span>
        </div>
        <input
          type="range"
          min="1"
          max={market?.maxLeverage || 20}
          value={leverage}
          onChange={e => setLeverage(parseInt(e.target.value))}
          className="w-full accent-sakura-500"
        />
        <div className="flex justify-between text-[10px] text-terminal-text-muted">
          <span>1x</span>
          <span>{market?.maxLeverage || 20}x</span>
        </div>
      </div>

      {/* Summary */}
      {size && market && (
        <div className="bg-terminal-bg rounded-lg p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Entry Price</span>
            <span className="font-mono">${market.markPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Margin ({marginMode})</span>
            <span className="font-mono">
              ${((parseFloat(size) * market.markPrice) / leverage).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Notional</span>
            <span className="font-mono">
              ${(parseFloat(size) * market.markPrice).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Execute — no browser-callable perps execute endpoint exists yet.
          /v1/agent/perps/quote uses agentBearerAuth (agent API key only).
          Gate with coming soon until a /webapp/me/perps/execute route is added.
          perpsRoutesAvailable() is the single switch that ungates the write path. */}
      <button
        disabled={!perpsRoutesAvailable()}
        title={
          perpsRoutesAvailable()
            ? undefined
            : 'Order execution coming soon — not yet available'
        }
        data-testid="perps-execute"
        className={`w-full py-3 rounded font-semibold text-sm transition-colors cursor-not-allowed opacity-50
          ${side === 'long'
            ? 'bg-bull/30 text-white'
            : 'bg-bear/30 text-white'
          }`}
      >
        Coming soon — execution not yet available
      </button>
      <p className="text-[11px] text-terminal-text-muted text-center -mt-1">
        Market data is live. Order placement is under development.
      </p>
    </div>
  )
}
