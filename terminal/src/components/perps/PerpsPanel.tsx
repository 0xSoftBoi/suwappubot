import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { HLMarket } from '../../types/api'

export function PerpsPanel() {
  const [selectedMarket, setSelectedMarket] = useState('ETH-USD')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [size, setSize] = useState('')
  const [leverage, setLeverage] = useState(5)

  const { data: markets } = useQuery({
    queryKey: ['perps-markets'],
    queryFn: () => api.getPerpsMarkets(),
    staleTime: 30_000,
  })

  const market = markets?.find((m: HLMarket) => m.name === selectedMarket)

  return (
    <div className="p-4 flex flex-col gap-3">
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
        >
          {markets?.map((m: HLMarket) => (
            <option key={m.name} value={m.name}>
              {m.name} — ${m.markPrice.toFixed(2)}
            </option>
          ))}
        </select>
      </div>

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

      {/* Size */}
      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Size ({market?.asset || '...'})</label>
        <input
          type="text"
          value={size}
          onChange={e => setSize(e.target.value)}
          placeholder="0.0"
          className="terminal-input w-full font-mono"
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
            <span className="text-terminal-text-secondary">Margin</span>
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
          Gate with coming soon until a /webapp/me/perps/execute route is added. */}
      <button
        disabled
        title="Order execution coming soon — not yet available"
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
