import { useState } from 'react'
import toast from 'react-hot-toast'
import type { HLMarket } from '../../types/api'
import { useAuth } from '../../contexts/AuthContext'
import { usePerpsFunding, formatCountdown, formatFundingPct } from '../../hooks/usePerpsFunding'
import { usePerpsMarginMode } from '../../hooks/usePerpsMarginMode'
import { usePerpsAccount, useExecutePerps } from '../../hooks/useTerminalPerps'
import { ConnectHyperliquid } from './ConnectHyperliquid'
import type { MarginMode } from '../../types/perps'

interface Props {
  markets?: HLMarket[]
  selectedMarket: string
  onSelectMarket: (market: string) => void
}

// Perps order ticket. Market is controlled by the workspace (so the markets
// board + ticket stay in sync). Execution is real: it posts to
// /terminal/perps/execute, which routes to the same perps_service the Telegram
// bot trades through. Gated behind a one-time HyperLiquid connect.
export function PerpsPanel({ markets, selectedMarket, onSelectMarket }: Props) {
  const { isAuthenticated } = useAuth()
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [size, setSize] = useState('')
  const [leverage, setLeverage] = useState(5)
  const [marginMode, setMarginMode] = usePerpsMarginMode()

  const { data: account } = usePerpsAccount()
  const execute = useExecutePerps()

  const market = markets?.find((m: HLMarket) => m.name === selectedMarket)
  const funding = usePerpsFunding(market)

  const marginModes: { value: MarginMode; label: string }[] = [
    { value: 'cross', label: 'Cross' },
    { value: 'isolated', label: 'Isolated' },
  ]

  const connected = !!account?.connected
  const sizeNum = parseFloat(size)
  const canSubmit =
    isAuthenticated && connected && market && sizeNum > 0 && !execute.isPending

  async function submit() {
    if (!market || !(sizeNum > 0)) return
    try {
      const res = await execute.mutateAsync({
        market: selectedMarket,
        side,
        size: sizeNum,
        leverage,
      })
      toast.success(
        `${side === 'long' ? 'Long' : 'Short'} ${res.position.size} ${market.asset} @ $${res.position.entryPrice.toFixed(2)}`,
      )
      setSize('')
    } catch (e) {
      toast.error((e as { detail?: string })?.detail || 'Order failed. Try again.')
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Perpetuals</h3>
        <span className="text-xs text-terminal-text-muted">via HyperLiquid</span>
      </div>

      {/* Market selector */}
      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Market</label>
        <select
          value={selectedMarket}
          onChange={(e) => onSelectMarket(e.target.value)}
          className="terminal-input w-full text-sm"
        >
          {markets?.map((m: HLMarket) => (
            <option key={m.name} value={m.name}>
              {m.name} — ${m.markPrice.toFixed(2)}
            </option>
          ))}
        </select>
      </div>

      {/* Live funding — real rate + next-funding countdown */}
      {market && (
        <div className="flex items-center justify-between bg-terminal-bg rounded px-3 py-2 text-xs">
          <span className="text-terminal-text-secondary">Funding / 1h</span>
          <span className="flex items-center gap-2 font-mono">
            <span className={funding.hourlyRate >= 0 ? 'text-bull' : 'text-bear'}>
              {formatFundingPct(funding.hourlyRate)}
            </span>
            <span className="text-terminal-text-muted">·</span>
            <span
              className="text-terminal-text-muted"
              title="Time until the next hourly funding payment"
            >
              in {formatCountdown(funding.msUntilNextFunding)}
            </span>
          </span>
        </div>
      )}

      {/* Margin mode (saved locally as a preference; applies at order time) */}
      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">Margin mode</label>
        <div className="grid grid-cols-2 gap-1">
          {marginModes.map((m) => (
            <button
              key={m.value}
              onClick={() => setMarginMode(m.value)}
              className={`py-1.5 rounded text-xs font-semibold transition-colors
                ${
                  marginMode === m.value
                    ? 'bg-terminal-bg-tertiary border border-sakura-500 text-terminal-text'
                    : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary'
                }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-1">
        <button
          onClick={() => setSide('long')}
          className={`py-2 rounded text-sm font-semibold transition-colors
            ${
              side === 'long'
                ? 'bg-bull text-white'
                : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary'
            }`}
        >
          Long
        </button>
        <button
          onClick={() => setSide('short')}
          className={`py-2 rounded text-sm font-semibold transition-colors
            ${
              side === 'short'
                ? 'bg-bear text-white'
                : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary'
            }`}
        >
          Short
        </button>
      </div>

      {/* Size */}
      <div>
        <label className="text-xs text-terminal-text-secondary mb-1 block">
          Size ({market?.asset || '...'})
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={size}
          onChange={(e) => setSize(e.target.value)}
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
          onChange={(e) => setLeverage(parseInt(e.target.value))}
          className="w-full accent-sakura-500"
        />
        <div className="flex justify-between text-[10px] text-terminal-text-muted">
          <span>1x</span>
          <span>{market?.maxLeverage || 20}x</span>
        </div>
      </div>

      {/* Summary */}
      {sizeNum > 0 && market && (
        <div className="bg-terminal-bg rounded-lg p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Entry Price</span>
            <span className="font-mono">${market.markPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Margin ({marginMode})</span>
            <span className="font-mono">
              ${((sizeNum * market.markPrice) / leverage).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Notional</span>
            <span className="font-mono">${(sizeNum * market.markPrice).toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Execute — gated behind sign-in + HyperLiquid connect */}
      {!isAuthenticated ? (
        <p className="text-center text-xs text-terminal-text-muted py-2">
          Sign in to trade perpetuals.
        </p>
      ) : !connected ? (
        <div className="rounded-lg border border-terminal-border bg-terminal-bg">
          <ConnectHyperliquid />
        </div>
      ) : (
        <button
          onClick={submit}
          disabled={!canSubmit}
          className={`w-full py-3 rounded font-semibold text-sm text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50
            ${side === 'long' ? 'bg-bull' : 'bg-bear'}`}
        >
          {execute.isPending
            ? 'Placing…'
            : `${side === 'long' ? 'Long' : 'Short'} ${market?.asset || ''}`}
        </button>
      )}
    </div>
  )
}
