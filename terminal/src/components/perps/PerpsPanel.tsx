import { useState } from 'react'
import toast from 'react-hot-toast'
import type { HLMarket, PerpsOrderType } from '../../types/api'
import { useAuth } from '../../contexts/AuthContext'
import { usePerpsFunding, formatCountdown, formatFundingPct } from '../../hooks/usePerpsFunding'
import { usePerpsMarginMode } from '../../hooks/usePerpsMarginMode'
import { usePerpsAccount, useExecutePerps } from '../../hooks/useTerminalPerps'
import { ConnectHyperliquid } from './ConnectHyperliquid'
import { usePersistentState } from '../../lib/persist'
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
  const [orderType, setOrderType] = useState<PerpsOrderType>('market')
  const [size, setSize] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [tpPrice, setTpPrice] = useState('')
  const [slPrice, setSlPrice] = useState('')
  const [leverage, setLeverage] = usePersistentState('leverage', 5)
  const [marginMode, setMarginMode] = usePerpsMarginMode()

  const numeric = (raw: string) => raw.replace(/[^\d.]/g, '')

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
  const limitNum = parseFloat(limitPrice)
  const tpNum = parseFloat(tpPrice)
  const slNum = parseFloat(slPrice)
  const isLimit = orderType === 'limit'
  const limitValid = !isLimit || limitNum > 0
  // Reference price for the order summary — the limit price for a limit order,
  // otherwise the live mark.
  const refPrice = isLimit && limitNum > 0 ? limitNum : market?.markPrice ?? 0

  // Estimated liquidation for a FRESH ISOLATED position, excluding fees &
  // funding. HyperLiquid's maintenance margin is half the initial margin at max
  // leverage → maintenance-margin fraction = 1/(2·maxLeverage). Cross margin and
  // existing positions move the real level, so this is labelled an estimate.
  const mmf = market?.maxLeverage ? 1 / (2 * market.maxLeverage) : 0
  const liqPrice =
    refPrice > 0 && leverage > 0 && mmf > 0 && mmf < 1
      ? side === 'long'
        ? (refPrice * (1 - 1 / leverage)) / (1 - mmf)
        : (refPrice * (1 + 1 / leverage)) / (1 + mmf)
      : 0
  const liqDistancePct = liqPrice > 0 ? (Math.abs(liqPrice - refPrice) / refPrice) * 100 : 0
  const maintMargin = mmf * sizeNum * refPrice

  // Live account health: maintenance margin ÷ equity, PROJECTED to include this
  // order. At 100% the account is liquidated. Null when equity is unavailable
  // (HL fetch failed or no funds) — the UI just omits the bar then.
  const equity = account?.accountValue ?? null
  const projectedMaint = (account?.maintenanceMarginUsed ?? 0) + (maintMargin > 0 ? maintMargin : 0)
  const marginRatioPct =
    equity && equity > 0 ? Math.min((projectedMaint / equity) * 100, 100) : null

  const canSubmit =
    isAuthenticated && connected && market && sizeNum > 0 && limitValid && !execute.isPending

  async function submit() {
    if (!market || !(sizeNum > 0)) return
    if (isLimit && !(limitNum > 0)) return
    try {
      const res = await execute.mutateAsync({
        market: selectedMarket,
        side,
        size: sizeNum,
        leverage,
        orderType,
        limitPrice: isLimit ? limitNum : undefined,
        tpPrice: !isLimit && tpNum > 0 ? tpNum : undefined,
        slPrice: !isLimit && slNum > 0 ? slNum : undefined,
      })
      if (res.kind === 'order' && res.order) {
        toast.success(
          `Limit ${side} ${res.order.size} ${market.asset} resting @ $${res.order.price.toFixed(2)}`,
        )
      } else if (res.position) {
        toast.success(
          `${side === 'long' ? 'Long' : 'Short'} ${res.position.size} ${market.asset} @ $${res.position.entryPrice.toFixed(2)}`,
        )
      }
      setSize('')
      setLimitPrice('')
      setTpPrice('')
      setSlPrice('')
    } catch (e) {
      toast.error((e as { detail?: string })?.detail || 'Order failed. Try again.')
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="perps-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Perpetuals</h3>
        <span className="text-xs text-terminal-text-muted">via HyperLiquid</span>
      </div>

      {/* Order type — market fills now; limit rests until price is reached */}
      <div role="radiogroup" aria-label="Order type" className="grid grid-cols-2 gap-1">
        {(['market', 'limit'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={orderType === t}
            onClick={() => setOrderType(t)}
            className={`py-1.5 rounded text-xs font-semibold capitalize transition-colors
              ${
                orderType === t
                  ? 'bg-terminal-bg-tertiary border border-sakura-500 text-terminal-text'
                  : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary'
              }`}
          >
            {t}
          </button>
        ))}
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
          onChange={(e) => setSize(numeric(e.target.value))}
          placeholder="0.0"
          className="terminal-input w-full font-mono"
        />
      </div>

      {/* Limit price — only for a limit order */}
      {isLimit && (
        <div>
          <label className="text-xs text-terminal-text-secondary mb-1 block">
            Limit price (USD)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={limitPrice}
            onChange={(e) => setLimitPrice(numeric(e.target.value))}
            placeholder={market ? market.markPrice.toFixed(2) : '0.00'}
            className="terminal-input w-full font-mono"
          />
        </div>
      )}

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

      {/* Take profit / stop loss — market orders only (a limit entry has no
          position yet to attach reduce-only triggers to). Both optional. */}
      {!isLimit && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-terminal-text-secondary mb-1 block">Take profit</label>
            <input
              type="text"
              inputMode="decimal"
              value={tpPrice}
              onChange={(e) => setTpPrice(numeric(e.target.value))}
              placeholder="Optional"
              aria-label="Take profit price"
              className="terminal-input w-full font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-terminal-text-secondary mb-1 block">Stop loss</label>
            <input
              type="text"
              inputMode="decimal"
              value={slPrice}
              onChange={(e) => setSlPrice(numeric(e.target.value))}
              placeholder="Optional"
              aria-label="Stop loss price"
              className="terminal-input w-full font-mono"
            />
          </div>
        </div>
      )}

      {/* Summary */}
      {sizeNum > 0 && market && refPrice > 0 && (
        <div className="bg-terminal-bg rounded-lg p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">
              {isLimit ? 'Limit Price' : 'Entry Price'}
            </span>
            <span className="font-mono">${refPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Margin ({marginMode})</span>
            <span className="font-mono">${((sizeNum * refPrice) / leverage).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Notional</span>
            <span className="font-mono">${(sizeNum * refPrice).toFixed(2)}</span>
          </div>
          {maintMargin > 0 && (
            <div className="flex justify-between">
              <span className="text-terminal-text-secondary">Maint. margin</span>
              <span className="font-mono">${maintMargin.toFixed(2)}</span>
            </div>
          )}
          {liqPrice > 0 && (
            <div className="flex justify-between">
              <span
                className="text-terminal-text-secondary"
                title="Estimated for an isolated position; excludes fees & funding. Cross margin and existing positions shift the real level."
              >
                Est. liq. price
              </span>
              <span className="font-mono text-bear">
                ${liqPrice.toFixed(2)}
                <span className="ml-1 text-terminal-text-muted">
                  ({liqDistancePct.toFixed(1)}% away)
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Live account health — maintenance margin ÷ equity, after this order */}
      {connected && marginRatioPct != null && (
        <div className="bg-terminal-bg rounded-lg p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Account equity</span>
            <span className="font-mono">${(equity ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span
              className="text-terminal-text-secondary"
              title="Maintenance margin ÷ account equity, including this order. At 100% the account is liquidated."
            >
              Margin ratio{maintMargin > 0 ? ' (after)' : ''}
            </span>
            <span className="font-mono">{marginRatioPct.toFixed(1)}%</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-terminal-bg-tertiary"
            role="progressbar"
            aria-label="Account margin ratio"
            aria-valuenow={Math.round(marginRatioPct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full transition-all ${
                marginRatioPct < 50 ? 'bg-bull' : marginRatioPct < 80 ? 'bg-yellow-500' : 'bg-bear'
              }`}
              style={{ width: `${Math.max(marginRatioPct, 2)}%` }}
            />
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
            : isLimit
              ? `Place limit ${side}`
              : `${side === 'long' ? 'Long' : 'Short'} ${market?.asset || ''}`}
        </button>
      )}
    </div>
  )
}
