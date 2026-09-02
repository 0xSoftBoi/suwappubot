import { useEffect, useMemo, useState } from 'react'
import { parseServerTimestamp } from '../../lib/amounts'
import toast from 'react-hot-toast'
import { TokenInput } from '../swap/TokenInput'
import { SlippageControl } from '../swap/SlippageControl'
import { WalletConnect } from '../auth/WalletConnect'
import { useAuth } from '../../contexts/AuthContext'
import { useTrading } from '../../contexts/TradingContext'
import { useLimitOrders } from '../../hooks/useLimitOrders'
import { useSwapQuote } from '../../hooks/useSwapQuote'
import { usePopularTokens } from '../../hooks/useTokens'
import type { LimitOrder, LimitOrderType, SwapQuoteRequest, SwapToken } from '../../types/api'

type Mode = 'limit' | 'stop_loss' | 'take_profit'

const EXPIRY_OPTIONS: Array<{ label: string; hours: number | null }> = [
  { label: '1h', hours: 1 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
  { label: 'GTC', hours: null },
]

const USDC_ETHEREUM: SwapToken = {
  symbol: 'USDC',
  name: 'USD Coin',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  chain: 'ethereum',
  decimals: 6,
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function orderTypeLabel(type: LimitOrderType) {
  if (type === 'limit_buy') return 'Limit Buy'
  if (type === 'limit_sell') return 'Limit Sell'
  if (type === 'stop_loss') return 'Stop Loss'
  return 'Take Profit'
}

function statusClasses(status: LimitOrder['status']) {
  if (status === 'executed') return 'text-bull'
  if (status === 'failed' || status === 'expired') return 'text-bear'
  if (status === 'cancelled') return 'text-terminal-text-muted'
  return 'text-terminal-accent'
}

function tokenDecimals(symbol: string) {
  const normalized = symbol.toUpperCase()
  if (normalized === 'USDC' || normalized === 'USDT') return 6
  if (normalized === 'BTC' || normalized === 'WBTC') return 8
  return 18
}

function humanAmount(order: LimitOrder) {
  const raw = Number(order.amountRaw)
  if (!Number.isFinite(raw)) return order.amountRaw
  const value = raw / 10 ** tokenDecimals(order.fromToken)
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 })
}

function formatDate(value?: string | null) {
  if (!value) return 'GTC'
  const date = new Date(parseServerTimestamp(value))
  if (Number.isNaN(date.getTime())) return 'GTC'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function LimitOrderPanel() {
  const { isAuthenticated, needsTradingProof } = useAuth()
  const { side, setSide, limitPrice } = useTrading()
  const { orders, createOrder, cancelOrder } = useLimitOrders()
  const { data: popularTokens } = usePopularTokens('ethereum')
  const [mode, setMode] = useState<Mode>('limit')
  const [fromToken, setFromToken] = useState<SwapToken | null>(null)
  const [toToken, setToToken] = useState<SwapToken | null>(null)
  const [amount, setAmount] = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [expiryHours, setExpiryHours] = useState<number | null>(24)
  const [slippage, setSlippage] = useState(0.5)

  useEffect(() => {
    if (!targetPrice && limitPrice) setTargetPrice(limitPrice)
  }, [limitPrice, targetPrice])

  useEffect(() => {
    if (!popularTokens?.length || fromToken || toToken) return
    const eth = popularTokens.find(token => token.symbol === 'ETH')
    const usdc = popularTokens.find(token => token.symbol === 'USDC')
    if (eth && usdc) {
      setFromToken(usdc)
      setToToken(eth)
    }
  }, [fromToken, popularTokens, toToken])

  const orderType: LimitOrderType = mode === 'limit'
    ? (side === 'buy' ? 'limit_buy' : 'limit_sell')
    : mode

  const targetToken = orderType === 'limit_buy' ? toToken : fromToken
  const currentPriceRequest = useMemo<Partial<SwapQuoteRequest> | null>(() => {
    if (!targetToken || targetToken.symbol === 'USDC') return null
    if (targetToken.chain !== 'ethereum') return null
    return {
      fromToken: targetToken.address,
      toToken: USDC_ETHEREUM.address,
      fromChain: targetToken.chain,
      toChain: 'ethereum',
      amount: '1',
      fromDecimals: targetToken.decimals,
      slippage,
    }
  }, [targetToken, slippage])
  const { data: currentPriceQuote } = useSwapQuote(currentPriceRequest, !!currentPriceRequest)
  const currentPrice = targetToken?.symbol === 'USDC'
    ? 1
    : currentPriceQuote
      ? parseFloat(currentPriceQuote.toAmount)
      : null

  const parsedAmount = parseFloat(amount)
  const parsedTarget = parseFloat(targetPrice)
  const hasPair = Boolean(fromToken && toToken && fromToken.address !== toToken.address)
  const priceInvalid = currentPrice && Number.isFinite(parsedTarget)
    ? orderType === 'limit_buy'
      ? parsedTarget > currentPrice
      : orderType === 'stop_loss'
        ? parsedTarget > currentPrice
        : parsedTarget < currentPrice
    : false
  const formReady =
    isAuthenticated &&
    !needsTradingProof &&
    hasPair &&
    parsedAmount > 0 &&
    parsedTarget > 0 &&
    !priceInvalid
  const activeOrders = orders.data?.filter(order => ['pending', 'triggered'].includes(order.status)) ?? []

  const adjustTarget = (pct: number) => {
    if (!currentPrice) return
    setTargetPrice((currentPrice * (1 + pct / 100)).toFixed(currentPrice > 10 ? 2 : 6))
  }

  const submit = () => {
    if (!formReady || !fromToken || !toToken) return
    createOrder.mutate(
      {
        orderType,
        fromToken: fromToken.symbol,
        toToken: toToken.symbol,
        fromChain: fromToken.chain,
        toChain: toToken.chain,
        amount: parsedAmount,
        triggerPrice: parsedTarget,
        slippage,
        expiresInHours: expiryHours,
      },
      {
        onSuccess: (order) => {
          toast.success(`${orderTypeLabel(order.orderType)} created`)
          setAmount('')
          setTargetPrice('')
        },
        onError: (err: unknown) => {
          const message = err && typeof err === 'object' && 'detail' in err
            ? (err as { detail: string }).detail
            : 'Limit order failed'
          toast.error(message)
        },
      },
    )
  }

  const cancel = (order: LimitOrder) => {
    if (!window.confirm(`Cancel ${orderTypeLabel(order.orderType)} ${order.fromToken}/${order.toToken}?`)) return
    cancelOrder.mutate(order.id, {
      onSuccess: () => toast.success('Limit order cancelled'),
      onError: (err: unknown) => {
        const message = err && typeof err === 'object' && 'detail' in err
          ? (err as { detail: string }).detail
          : 'Cancel failed'
        toast.error(message)
      },
    })
  }

  return (
    <div className="mt-3 flex flex-col gap-3" data-testid="limit-order-panel">
      <div className="grid grid-cols-3 gap-1">
        {[
          { id: 'limit', label: 'Limit' },
          { id: 'stop_loss', label: 'Stop' },
          { id: 'take_profit', label: 'Profit' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMode(tab.id as Mode)}
            className={joinClasses(
              'terminal-theme-control min-h-[34px] px-2 text-xs font-semibold transition-colors hover:translate-y-0',
              mode === tab.id ? 'terminal-theme-control-active text-terminal-text' : 'text-terminal-text-secondary',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === 'limit' && (
        <div className="grid grid-cols-2 gap-1">
          <button
            onClick={() => setSide('buy')}
            className={joinClasses(
              'rounded border px-3 py-2 text-sm font-semibold transition-colors',
              side === 'buy'
                ? 'border-bull/50 bg-bull/15 text-bull'
                : 'border-terminal-border bg-terminal-bg text-terminal-text-secondary',
            )}
          >
            Buy
          </button>
          <button
            onClick={() => setSide('sell')}
            className={joinClasses(
              'rounded border px-3 py-2 text-sm font-semibold transition-colors',
              side === 'sell'
                ? 'border-bear/50 bg-bear/15 text-bear'
                : 'border-terminal-border bg-terminal-bg text-terminal-text-secondary',
            )}
          >
            Sell
          </button>
        </div>
      )}

      <TokenInput
        label={orderType === 'limit_buy' ? 'Spend' : 'Sell'}
        token={fromToken}
        amount={amount}
        onAmountChange={setAmount}
        onTokenSelect={setFromToken}
        showBalance
      />

      <TokenInput
        label={orderType === 'limit_buy' ? 'Buy' : 'Receive'}
        token={toToken}
        amount=""
        onTokenSelect={setToToken}
        readOnly
      />

      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-terminal-text-secondary">Target USD</span>
          <input
            data-testid="limit-target-price"
            type="text"
            value={targetPrice}
            onChange={e => setTargetPrice(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            className="terminal-input w-full font-mono"
          />
        </label>
        <div className="pb-1 text-right">
          <div className="terminal-theme-caption text-[10px] uppercase text-terminal-text-muted">
            Market
          </div>
          <div className="tnum font-mono text-sm text-terminal-text">
            {currentPrice ? `$${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : '--'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {(orderType === 'limit_buy' || orderType === 'stop_loss'
          ? [-20, -10, -5, -1]
          : [1, 5, 10, 20]
        ).map((pct) => (
          <button
            key={pct}
            onClick={() => adjustTarget(pct)}
            disabled={!currentPrice}
            className="terminal-theme-control min-h-[30px] px-2 font-mono text-[11px] text-terminal-text-secondary disabled:opacity-40"
          >
            {pct > 0 ? `+${pct}%` : `${pct}%`}
          </button>
        ))}
      </div>

      {priceInvalid && (
        <div className="rounded border border-bear/30 bg-bear-dim px-3 py-2 text-xs text-bear">
          {orderType === 'limit_buy'
            ? 'Limit buy target must be below market.'
            : orderType === 'stop_loss'
              ? 'Stop target must be below market.'
              : 'Sell target must be above market.'}
        </div>
      )}

      <SlippageControl value={slippage} onChange={setSlippage} />

      <div>
        <div className="mb-1 text-xs text-terminal-text-secondary">Expires</div>
        <div className="grid grid-cols-5 gap-1">
          {EXPIRY_OPTIONS.map(opt => (
            <button
              key={opt.label}
              onClick={() => setExpiryHours(opt.hours)}
              className={joinClasses(
                'terminal-theme-control min-h-[32px] px-2 text-xs font-medium transition-colors hover:translate-y-0',
                expiryHours === opt.hours ? 'terminal-theme-control-active text-terminal-text' : 'text-terminal-text-secondary',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {!isAuthenticated || needsTradingProof ? (
        <WalletConnect preferredChain="ethereum" showGoogle={!isAuthenticated} />
      ) : (
        <button
          data-testid="create-limit-order"
          onClick={submit}
          disabled={!formReady || createOrder.isPending}
          className={joinClasses(
            'w-full rounded bg-terminal-accent py-3 text-sm font-semibold text-terminal-on-accent transition-colors hover:bg-terminal-accent-bright disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {createOrder.isPending ? 'Creating...' : `Create ${orderTypeLabel(orderType)}`}
        </button>
      )}

      <div className="border-t border-terminal-border pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-terminal-text-secondary">
            Active Orders
          </span>
          <span className="font-mono text-xs text-terminal-text-muted">{activeOrders.length}</span>
        </div>

        {orders.isLoading ? (
          <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-4 text-center text-xs text-terminal-text-muted">
            Loading orders...
          </div>
        ) : activeOrders.length === 0 ? (
          <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-4 text-center text-xs text-terminal-text-muted">
            No active limit orders
          </div>
        ) : (
          <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1" data-testid="active-limit-orders">
            {activeOrders.map(order => (
              <div key={order.id} className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-terminal-text">
                      {order.fromToken}/{order.toToken}
                    </div>
                    <div className="font-mono text-xs text-terminal-text-secondary">
                      {orderTypeLabel(order.orderType)} @ ${order.triggerPrice.toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => cancel(order)}
                    disabled={cancelOrder.isPending}
                    className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-text-secondary transition-colors hover:border-bear/50 hover:text-bear disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <div className="terminal-theme-caption text-terminal-text-muted">Amount</div>
                    <div className="font-mono text-terminal-text">{humanAmount(order)} {order.fromToken}</div>
                  </div>
                  <div>
                    <div className="terminal-theme-caption text-terminal-text-muted">Expiry</div>
                    <div className="font-mono text-terminal-text">{formatDate(order.expiresAt)}</div>
                  </div>
                  <div>
                    <div className="terminal-theme-caption text-terminal-text-muted">Status</div>
                    <div className={joinClasses('font-mono capitalize', statusClasses(order.status))}>{order.status}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
