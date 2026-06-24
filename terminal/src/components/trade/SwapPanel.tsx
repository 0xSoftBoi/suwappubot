import { useState, useEffect, useRef } from 'react'
import { OrderTabs } from './OrderTabs'
import { TokenSafetyStrip } from './TokenSafetyStrip'
import { TokenInput } from '../swap/TokenInput'
import { QuoteComparison } from '../swap/QuoteComparison'
import { SlippageControl } from '../swap/SlippageControl'
import { LimitOrderPanel } from './LimitOrderPanel'
import { DCAPanel } from './DCAPanel'
import { useSwapQuote } from '../../hooks/useSwapQuote'
import { useSwapExecute } from '../../hooks/useSwapExecute'
import { useExternalSwap } from '../../hooks/useExternalSwap'
import { useSolanaSwap } from '../../hooks/useSolanaSwap'
import { WalletConnect } from '../auth/WalletConnect'
import { useAuth } from '../../contexts/AuthContext'
import { useTrading } from '../../contexts/TradingContext'
import { usePair } from '../../contexts/PairContext'
import { useQuery } from '@tanstack/react-query'
import type { SwapToken, SwapQuoteRequest, SolanaPriorityTier } from '../../types/api'
import { getSolanaPriorityFees } from '../../lib/helius'
import toast from 'react-hot-toast'

type OrderTab = 'swap' | 'limit' | 'dca'

export function SwapPanel() {
  const { isAuthenticated, isExternalWallet, externalChain } = useAuth()
  const { side, setSide, pendingSwapAmount, setPendingSwapAmount } = useTrading()
  const { selectedPair, setSelectedPair } = usePair()
  const [activeTab, setActiveTab] = useState<OrderTab>('swap')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(0.5)
  // Solana priority-fee tier — only affects the non-custodial Phantom path,
  // so it's surfaced (below) only for Solana tokens.
  const [priorityTier, setPriorityTier] = useState<SolanaPriorityTier>('normal')
  const [showTpSl, setShowTpSl] = useState(false)
  const [tpPrice, setTpPrice] = useState('')
  const [slPrice, setSlPrice] = useState('')

  // Single source of truth: the from/to tokens are *derived* from the active
  // pair + side, so switching the pair anywhere (header search, watchlist,
  // pulse feed) instantly updates what you're trading. Buying spends the quote
  // (e.g. USDC) to acquire the base; selling does the reverse.
  const baseToken = selectedPair.base
  const quoteToken = selectedPair.quote
  const fromToken = side === 'buy' ? quoteToken : baseToken
  const toToken = side === 'buy' ? baseToken : quoteToken

  // Write a token change back into the shared pair so the chart, order book and
  // header all follow. Token selectors stay free to pick any chain — overriding
  // a token just updates the pair (keeps cross-chain swaps working).
  const setPairFromTokens = (nextFrom: SwapToken | null, nextTo: SwapToken | null) => {
    if (!nextFrom || !nextTo) return
    const nextBase = side === 'buy' ? nextTo : nextFrom
    const nextQuote = side === 'buy' ? nextFrom : nextTo
    setSelectedPair({ base: nextBase, quote: nextQuote })
  }

  const setFromToken = (token: SwapToken) => setPairFromTokens(token, toToken)
  const setToToken = (token: SwapToken) => setPairFromTokens(fromToken, token)

  const quoteRequest: Partial<SwapQuoteRequest> | null = fromToken && toToken && amount ? {
    fromToken: fromToken.address,
    toToken: toToken.address,
    fromChain: fromToken.chain,
    toChain: toToken.chain,
    amount,
    fromDecimals: fromToken.decimals,
    slippage,
  } : null

  const { data: quote, isLoading: quoteLoading, error: quoteError, refetch: refetchQuote } = useSwapQuote(quoteRequest)
  const { mutate: executeSwap, isPending: executing } = useSwapExecute()
  const { mutate: executeExternalSwap, isPending: externalExecuting } = useExternalSwap()
  const { mutate: executeSolanaSwap, isPending: solanaExecuting } = useSolanaSwap()
  const executingAny = executing || externalExecuting || solanaExecuting

  // Live Solana network priority fee (Helius), used to calibrate the Speed tiers.
  const isSolana = fromToken?.chain === 'solana'
  const priorityFees = useQuery({
    queryKey: ['sol-priority-fees'],
    queryFn: getSolanaPriorityFees,
    enabled: isSolana,
    staleTime: 15_000,
    refetchInterval: 20_000,
  })
  const LEVEL_BY_TIER = { normal: 'medium', fast: 'high', turbo: 'veryHigh' } as const
  const liveMicroPerCu = priorityFees.data ? priorityFees.data[LEVEL_BY_TIER[priorityTier]] : null
  // ~200k compute units is typical for a Jupiter swap — this is an estimate.
  const liveFeeSol = liveMicroPerCu != null ? (liveMicroPerCu * 200_000) / 1e15 : null

  // FIX 5: Ticking staleness check — flips to true without user interaction
  const [isQuoteStale, setIsQuoteStale] = useState(false)
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (staleTimerRef.current) clearInterval(staleTimerRef.current)
    if (!quote?.expiresAt) {
      setIsQuoteStale(false)
      return
    }
    const check = () => setIsQuoteStale(Date.now() >= new Date(quote.expiresAt).getTime())
    check()
    staleTimerRef.current = setInterval(check, 1000)
    return () => { if (staleTimerRef.current) clearInterval(staleTimerRef.current) }
  }, [quote?.expiresAt, quote?.id])

  const errMessage = (err: unknown, fallback = 'Swap failed') =>
    err && typeof err === 'object' && 'detail' in err
      ? (err as { detail: string }).detail
      : err instanceof Error
        ? err.message
        : fallback

  const handleSwap = () => {
    // Non-custodial: the connected external wallet signs + broadcasts client-side.
    // We re-build a fresh unsigned tx (server holds no key) rather than reusing the
    // custodial quoteId path. Route by token chain, and guard wallet/chain mismatch.
    if (isExternalWallet) {
      if (!fromToken || !toToken || !amount) return
      const tokenIsSolana = fromToken.chain === 'solana'

      if (tokenIsSolana && externalChain !== 'solana') {
        toast.error('Connect a Solana wallet (Phantom) to trade Solana tokens.')
        return
      }
      if (!tokenIsSolana && externalChain !== 'evm') {
        toast.error('Connect an EVM wallet (MetaMask) to trade this token.')
        return
      }

      const onSuccess = (result: { txHash: string }) => {
        toast.success(`Swap submitted — ${result.txHash.slice(0, 10)}…`)
        setAmount('')
      }
      const onError = (err: unknown) =>
        toast.error(errMessage(err, 'Wallet rejected or swap failed'))

      if (tokenIsSolana) {
        executeSolanaSwap(
          {
            fromToken: fromToken.address,
            toToken: toToken.address,
            amount,
            slippage,
            priority: priorityTier,
            // Apply the live network per-CU price on the non-Jito tiers; turbo
            // uses a Jito tip instead.
            computeUnitPriceMicroLamports:
              priorityTier !== 'turbo' && liveMicroPerCu != null
                ? Math.round(liveMicroPerCu)
                : undefined,
          },
          { onSuccess, onError }
        )
        return
      }

      executeExternalSwap(
        {
          fromToken: fromToken.address,
          toToken: toToken.address,
          fromChain: fromToken.chain,
          toChain: toToken.chain,
          amount,
          slippage,
        },
        { onSuccess, onError }
      )
      return
    }

    if (!quote) return
    executeSwap(
      { quoteId: quote.id },
      {
        onSuccess: (result) => {
          toast.success(`Swap ${result.status}: ${result.swap.fromAmount} ${result.swap.fromToken} → ${result.swap.expectedToAmount} ${result.swap.toToken}`)
          setAmount('')
        },
        onError: (err: unknown) => toast.error(errMessage(err)),
      }
    )
  }

  // Buy, Sell and the flip arrow now all perform the same operation: from/to
  // derive from `side`, so switching side swaps the trade direction. Clear the
  // amount on a real side change so a value typed for the old `from` token isn't
  // silently re-quoted against the new one. Guard re-clicks of the active side.
  const changeSide = (next: 'buy' | 'sell') => {
    if (next === side) return
    setSide(next)
    setAmount('')
  }

  const flipTokens = () => changeSide(side === 'buy' ? 'sell' : 'buy')

  // FIX 3: Consume quick-buy pre-fill from DiscoveryPanel
  useEffect(() => {
    if (!pendingSwapAmount) return
    setSide('buy')
    setAmount(pendingSwapAmount)
    setPendingSwapAmount('')
  }, [pendingSwapAmount, setPendingSwapAmount, setSide])

  if (activeTab === 'limit') {
    return (
      <div className="p-4">
        <OrderTabs active={activeTab} onSelect={setActiveTab} />
        <LimitOrderPanel />
      </div>
    )
  }

  if (activeTab === 'dca') {
    return (
      <div className="p-4">
        <OrderTabs active={activeTab} onSelect={setActiveTab} />
        <DCAPanel />
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-3" data-testid="swap-panel">
      {/* Buy/Sell toggle */}
      <div className="grid grid-cols-2 gap-1">
        <button
          onClick={() => changeSide('buy')}
          aria-pressed={side === 'buy'}
          disabled={executingAny}
          className={`py-2 rounded text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed
            ${side === 'buy'
              ? 'bg-bull/20 text-bull'
              : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary'
            }`}
        >
          Buy
        </button>
        <button
          onClick={() => changeSide('sell')}
          aria-pressed={side === 'sell'}
          disabled={executingAny}
          className={`py-2 rounded text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed
            ${side === 'sell'
              ? 'bg-bear/20 text-bear'
              : 'bg-terminal-bg border border-terminal-border text-terminal-text-secondary'
            }`}
        >
          Sell
        </button>
      </div>

      <OrderTabs active={activeTab} onSelect={setActiveTab} />

      {/* From Token */}
      <TokenInput
        label="From"
        token={fromToken}
        amount={amount}
        onAmountChange={setAmount}
        onTokenSelect={setFromToken}
        showBalance
      />

      {/* Flip button */}
      <div className="flex justify-center -my-1">
        <button
          onClick={flipTokens}
          disabled={executingAny}
          aria-label="Flip swap direction"
          className="w-8 h-8 rounded-full bg-terminal-bg-tertiary border border-terminal-border
                     flex items-center justify-center text-terminal-text-secondary
                     hover:text-sakura-400 hover:border-sakura-600 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      {/* To Token */}
      <TokenInput
        label="To"
        token={toToken}
        amount={quote?.toAmount || ''}
        onTokenSelect={setToToken}
        readOnly
      />

      {/* Pre-trade safety check on the token being acquired (honeypot, tax,
          authorities, LP, concentration) — loud + red when it's a honeypot. */}
      {toToken && (
        <TokenSafetyStrip chain={toToken.chain} address={toToken.address} symbol={toToken.symbol} />
      )}

      {/* Slippage */}
      <SlippageControl value={slippage} onChange={setSlippage} />

      {/* Solana priority fee — controls landing speed under congestion. Only the
          non-custodial Phantom path consumes it, so show it only for SOL tokens. */}
      {fromToken?.chain === 'solana' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="terminal-theme-caption shrink-0 px-1 text-[10px] uppercase text-terminal-text-muted">
            Speed
          </span>
          <div
            role="radiogroup"
            aria-label="Solana transaction priority"
            className="flex min-w-0 flex-1 gap-1"
          >
            {([
              ['normal', 'Normal', '~0.001 SOL priority fee'],
              ['fast', 'Fast', '~0.005 SOL priority fee — lands faster under congestion'],
              ['turbo', 'Turbo', 'MEV-protected Jito bundle (~0.005 SOL tip)'],
            ] as const).map(([val, label, hint]) => (
              <button
                key={val}
                type="button"
                role="radio"
                aria-checked={priorityTier === val}
                title={hint}
                onClick={() => setPriorityTier(val)}
                className={`terminal-theme-control min-h-[32px] flex-1 px-2.5 py-1 text-[11px] font-medium transition-colors hover:translate-y-0 focus:translate-y-0 active:scale-[0.98] ${
                  priorityTier === val
                    ? 'terminal-theme-control-active text-terminal-text'
                    : 'text-terminal-text-secondary hover:text-terminal-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="w-full pl-1 text-[10px] text-terminal-text-muted">
            {priorityTier === 'turbo'
              ? 'Turbo routes via Jito for MEV protection (~0.005 SOL tip)'
              : liveFeeSol != null
                ? `Live network priority (${priorityTier}): ~${
                    liveFeeSol < 0.000001 ? '<0.000001' : liveFeeSol.toFixed(6)
                  } SOL`
                : 'Fetching live network priority fee…'}
          </p>
        </div>
      )}

      {/* TP/SL — Coming soon: backend execute endpoint only accepts quoteId */}
      <div>
        <button
          onClick={() => setShowTpSl(prev => !prev)}
          className="text-xs text-terminal-text-secondary hover:text-terminal-text-primary transition-colors"
        >
          TP/SL {showTpSl ? '▴' : '▾'}
          <span className="ml-1.5 text-[10px] text-terminal-text-muted italic">Coming soon</span>
        </button>
        {showTpSl && (
          <div className="mt-2 flex flex-col gap-2 opacity-50 pointer-events-none select-none">
            <div>
              <label className="text-xs text-terminal-text-secondary mb-1 block">Take Profit</label>
              <input
                type="text"
                value={tpPrice}
                onChange={e => setTpPrice(e.target.value)}
                placeholder="TP price"
                disabled
                className="terminal-input w-full font-mono text-sm"
              />
              <div className="flex gap-1 mt-1">
                {['+5%', '+10%', '+20%'].map(pct => (
                  <button
                    key={pct}
                    disabled
                    className="text-xs px-2 py-0.5 rounded bg-terminal-bg-tertiary text-terminal-text-secondary"
                  >
                    {pct}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-terminal-text-secondary mb-1 block">Stop Loss</label>
              <input
                type="text"
                value={slPrice}
                onChange={e => setSlPrice(e.target.value)}
                placeholder="SL price"
                disabled
                className="terminal-input w-full font-mono text-sm"
              />
              <div className="flex gap-1 mt-1">
                {['-5%', '-10%', '-20%'].map(pct => (
                  <button
                    key={pct}
                    disabled
                    className="text-xs px-2 py-0.5 rounded bg-terminal-bg-tertiary text-terminal-text-secondary"
                  >
                    {pct}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quote details */}
      {quote && <QuoteComparison quote={quote} />}

      {/* Quote error */}
      {quoteError && (
        <div role="alert" aria-live="assertive" className="text-sm text-red-400 bg-bear-dim rounded px-3 py-2">
          {(quoteError as { detail?: string }).detail || 'Failed to get quote'}
        </div>
      )}

      {/* Execute button (or connect/sign-in when not authenticated) */}
      {!isAuthenticated ? (
        <WalletConnect />
      ) : (
        <button
          onClick={isQuoteStale ? () => void refetchQuote() : handleSwap}
          disabled={!isQuoteStale && (!quote || executingAny)}
          className={`w-full py-3 text-base font-semibold rounded transition-colors disabled:opacity-50 ${
            isQuoteStale
              ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/40 hover:bg-yellow-600/30'
              : side === 'buy'
                ? 'bg-bull hover:bg-bull/80 text-white disabled:bg-bull/30'
                : 'bg-bear hover:bg-bear/80 text-white disabled:bg-bear/30'
          }`}
        >
          {isQuoteStale
            ? 'Quote expired — refresh'
            : externalExecuting || solanaExecuting
              ? 'Confirm in your wallet…'
              : executing
                ? 'Executing...'
                : quoteLoading
                  ? 'Getting Quote...'
                  : quote
                    ? `${side === 'buy' ? 'Buy' : 'Sell'} ${toToken?.symbol || ''}${isExternalWallet ? ' (self-custody)' : ''}`
                    : 'Enter Amount'
          }
        </button>
      )}

      {/* Fee estimate */}
      <div className="text-xs text-terminal-text-muted text-center">
        {quote
          ? `Est. fee: ~$${quote.gasUsd.toFixed(2)}`
          : 'Enter amount for fee estimate'
        }
      </div>
    </div>
  )
}
