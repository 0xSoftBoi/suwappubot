import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { HLMarket, PerpsOrderType } from '../../types/api'
import { useAuth } from '../../contexts/AuthContext'
import { usePerpsFunding, formatCountdown, formatFundingPct } from '../../hooks/usePerpsFunding'
import { usePerpsMarginMode } from '../../hooks/usePerpsMarginMode'
import { usePerpsAccount, useExecutePerps } from '../../hooks/useTerminalPerps'
import { ConnectHyperliquid } from './ConnectHyperliquid'
import { usePersistentState } from '../../lib/persist'
import type { MarginMode } from '../../types/perps'
import { clampLeverage, isLeverageValid, normalizeMaxLeverage } from '../../lib/perpsRisk'
import { WalletConnect } from '../auth/WalletConnect'

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
  const { isAuthenticated, needsTradingProof } = useAuth()
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
  const maxLeverage = normalizeMaxLeverage(market?.maxLeverage)
  const funding = usePerpsFunding(market)

  // A persisted leverage can become invalid when the market changes. Keep the
  // ticket bounded immediately; the backend still re-checks live HL metadata.
  useEffect(() => {
    setLeverage((current) => {
      const bounded = clampLeverage(current, maxLeverage)
      return bounded === current ? current : bounded
    })
  }, [maxLeverage, setLeverage])
  const fundingUp = funding.hourlyRate >= 0

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

  // DISPLAY-ONLY estimate. Never sent with the order; nothing below feeds
  // submit().
  //
  // HyperLiquid's published liquidation formula is
  //   liq = P − side · marginAvailable / size / (1 − mmf · side)
  // with side = +1 long / −1 short and mmf = 1 / maintenanceLeverage, where
  // maintenance leverage is 2× the market's max leverage (maintenance margin is
  // half the initial margin at max leverage) → mmf = 1/(2·maxLeverage).
  //
  // For a FRESH ISOLATED position, marginAvailable = notional/L − mmf·notional,
  // which reduces to the two closed forms below:
  //   long  → P·(1 − 1/L) / (1 − mmf)
  //   short → P·(1 + 1/L) / (1 + mmf)
  //
  // Assumptions (why it is labelled "Est. liq"): fresh isolated position, no
  // existing exposure in the asset, fees and funding excluded, and for a market
  // order the fill is assumed at the current mark. Cross margin and any open
  // position move the real level. Inputs are all already on hand — `market`
  // (maxLeverage, markPrice) from the markets query, plus ticket state.
  const mmf = market?.maxLeverage ? 1 / (2 * market.maxLeverage) : 0
  const liqPrice =
    marginMode === 'isolated' && refPrice > 0 && leverage > 0 && mmf > 0 && mmf < 1
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

  const leverageValid = isLeverageValid(leverage, maxLeverage)
  const canSubmit =
    isAuthenticated &&
    !needsTradingProof &&
    connected &&
    market &&
    sizeNum > 0 &&
    leverageValid &&
    limitValid &&
    !execute.isPending

  async function submit() {
    if (!market || !(sizeNum > 0)) return
    if (!leverageValid) return
    if (isLimit && !(limitNum > 0)) return
    try {
      const res = await execute.mutateAsync({
        market: selectedMarket,
        side,
        size: sizeNum,
        leverage,
        marginMode,
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
        <h3 className="text-sm font-semibold text-terminal-text">Perpetuals</h3>
        <span className="terminal-theme-caption text-[10px] uppercase">via HyperLiquid</span>
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
            className={`rounded-terminal-control border py-1.5 text-xs font-semibold capitalize transition-colors
              ${
                orderType === t
                  ? 'accent-wash border-terminal-border-active text-terminal-text'
                  : 'border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
              }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Market selector */}
      <div>
        <label className="terminal-theme-caption mb-1 block text-[10px] uppercase">Market</label>
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
        <div className="hairline flex items-center justify-between rounded-terminal-inset bg-terminal-bg px-3 py-2 text-xs">
          <span className="text-terminal-text-secondary">Funding / 1h</span>
          <span className="flex items-center gap-2 font-mono tnum">
            <span className={fundingUp ? 'text-bull' : 'text-bear'}>
              <span aria-hidden="true">{fundingUp ? '▲' : '▼'}</span>{' '}
              {formatFundingPct(funding.hourlyRate)}
            </span>
            <span className="text-terminal-text-muted" aria-hidden="true">
              ·
            </span>
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
        <label className="terminal-theme-caption mb-1 block text-[10px] uppercase">Margin mode</label>
        <div className="grid grid-cols-2 gap-1">
          {marginModes.map((m) => (
            <button
              key={m.value}
              onClick={() => setMarginMode(m.value)}
              className={`rounded-terminal-control border py-1.5 text-xs font-semibold transition-colors
                ${
                  marginMode === m.value
                    ? 'accent-wash border-terminal-border-active text-terminal-text'
                    : 'border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
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
          aria-pressed={side === 'long'}
          className={`rounded-terminal-control border py-2 text-sm font-semibold transition-colors
            ${
              side === 'long'
                ? 'border-bull bg-bull text-terminal-on-accent'
                : 'border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
            }`}
        >
          <span aria-hidden="true">▲</span> Long
        </button>
        <button
          onClick={() => setSide('short')}
          aria-pressed={side === 'short'}
          className={`rounded-terminal-control border py-2 text-sm font-semibold transition-colors
            ${
              side === 'short'
                ? 'border-bear bg-bear text-terminal-on-accent'
                : 'border-terminal-border text-terminal-text-secondary hover:text-terminal-text'
            }`}
        >
          <span aria-hidden="true">▼</span> Short
        </button>
      </div>

      {/* Size */}
      <div>
        <label className="terminal-theme-caption mb-1 block text-[10px] uppercase">
          Size ({market?.asset || '...'})
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={size}
          onChange={(e) => setSize(numeric(e.target.value))}
          placeholder="0.0"
          className="terminal-input w-full font-mono tnum"
        />
      </div>

      {/* Limit price — only for a limit order */}
      {isLimit && (
        <div>
          <label className="terminal-theme-caption mb-1 block text-[10px] uppercase">
            Limit price (USD)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={limitPrice}
            onChange={(e) => setLimitPrice(numeric(e.target.value))}
            placeholder={market ? market.markPrice.toFixed(2) : '0.00'}
            className="terminal-input w-full font-mono tnum"
          />
        </div>
      )}

      {/* Leverage slider */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="terminal-theme-caption text-[10px] uppercase">Leverage</label>
          <span className="accent-wash rounded-terminal-pill px-2 py-0.5 font-mono text-[11px] font-semibold tnum text-terminal-accent">
            {leverage}×
          </span>
        </div>
        <input
          type="range"
          min="1"
          max={maxLeverage}
          value={leverage}
          onChange={(e) => setLeverage(clampLeverage(parseInt(e.target.value), maxLeverage))}
          aria-label="Leverage"
          className="w-full accent-sakura-500"
        />
        <div className="flex justify-between font-mono text-[10px] tnum text-terminal-text-muted">
          <span>1×</span>
          <span>{maxLeverage}×</span>
        </div>
      </div>

      {/* Take profit / stop loss — market orders only (a limit entry has no
          position yet to attach reduce-only triggers to). Both optional. */}
      {!isLimit && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="terminal-theme-caption mb-1 block text-[10px] uppercase">
              Take profit
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={tpPrice}
              onChange={(e) => setTpPrice(numeric(e.target.value))}
              placeholder="Optional"
              aria-label="Take profit price"
              className="terminal-input w-full font-mono tnum"
            />
          </div>
          <div>
            <label className="terminal-theme-caption mb-1 block text-[10px] uppercase">
              Stop loss
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={slPrice}
              onChange={(e) => setSlPrice(numeric(e.target.value))}
              placeholder="Optional"
              aria-label="Stop loss price"
              className="terminal-input w-full font-mono tnum"
            />
          </div>
        </div>
      )}

      {/* Order summary — margin, notional and the est. liq level. Every value
          here is derived client-side from the ticket state + the live market;
          nothing is submitted with the order. */}
      {sizeNum > 0 && market && refPrice > 0 && (
        <div className="hairline rounded-terminal-inset bg-terminal-bg text-xs">
          {liqPrice > 0 && (
            <div className="hairline-b flex items-baseline justify-between px-3 py-2.5">
              <span className="flex flex-col gap-0.5">
                <span
                  className="terminal-theme-caption text-[10px] uppercase"
                  title="Estimated for an isolated position; excludes fees & funding. Cross margin and existing positions shift the real level."
                >
                  Est. liq
                </span>
                <span className="font-mono text-[10px] tnum text-terminal-text-muted">
                  {liqDistancePct.toFixed(1)}% from {isLimit ? 'limit' : 'mark'}
                </span>
                {/* The tooltip is invisible on touch — the core caveat must be
                    visible text, since cross is the default margin mode. */}
                <span className="text-[10px] text-terminal-text-muted">
                  isolated est. · excl. fees
                </span>
              </span>
              <span className="font-mono text-lg font-semibold leading-none tnum text-bear">
                <span aria-hidden="true">{side === 'long' ? '▼' : '▲'}</span> $
                {liqPrice.toFixed(2)}
              </span>
            </div>
          )}
          <div className="space-y-1.5 px-3 py-2.5">
            <div className="flex justify-between">
              <span className="text-terminal-text-secondary">
                {isLimit ? 'Limit price' : 'Entry price'}
              </span>
              <span className="font-mono tnum">${refPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-terminal-text-secondary">Margin ({marginMode})</span>
              <span className="font-mono tnum">
                ${((sizeNum * refPrice) / leverage).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-terminal-text-secondary">Notional</span>
              <span className="font-mono tnum">${(sizeNum * refPrice).toFixed(2)}</span>
            </div>
            {maintMargin > 0 && (
              <div className="flex justify-between">
                <span className="text-terminal-text-secondary">Maint. margin</span>
                <span className="font-mono tnum">${maintMargin.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live account health — maintenance margin ÷ equity, after this order */}
      {connected && marginRatioPct != null && (
        <div className="hairline space-y-1.5 rounded-terminal-inset bg-terminal-bg p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-terminal-text-secondary">Account equity</span>
            <span className="font-mono tnum">${(equity ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span
              className="text-terminal-text-secondary"
              title="Maintenance margin ÷ account equity, including this order. At 100% the account is liquidated."
            >
              Margin ratio{maintMargin > 0 ? ' (after)' : ''}
            </span>
            <span className="font-mono tnum">{marginRatioPct.toFixed(1)}%</span>
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
                marginRatioPct < 50
                  ? 'bg-bull'
                  : marginRatioPct < 80
                    ? 'bg-terminal-warn'
                    : 'bg-bear'
              }`}
              style={{ width: `${Math.max(marginRatioPct, 2)}%` }}
            />
          </div>
        </div>
      )}

      {/* Execute — gated behind sign-in + HyperLiquid connect */}
      {!isAuthenticated || needsTradingProof ? (
        <WalletConnect preferredChain="ethereum" showGoogle={!isAuthenticated} />
      ) : !connected ? (
        <ConnectHyperliquid />
      ) : (
        <button
          onClick={submit}
          disabled={!canSubmit}
          className={`w-full rounded-terminal-control py-3 text-sm font-semibold text-terminal-on-accent transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50
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
