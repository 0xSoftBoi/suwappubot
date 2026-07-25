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
import { usePersistentState } from '../../lib/persist'
import { useQuery } from '@tanstack/react-query'
import type { SwapToken, SwapQuoteRequest, SolanaPriorityTier } from '../../types/api'
import { getSolanaPriorityFees } from '../../lib/helius'
import toast from 'react-hot-toast'
import { TerminalSkeletonText, TerminalStatusPill } from '../foundation'

type OrderTab = 'swap' | 'limit' | 'dca'

// Real Suwappu fee ladder (matches the published showcase /pricing page):
// Published plan rates (matches showcase pricing). The terminal has no tier
// awareness and quote.fromAmountUsd historically holds token amounts, not USD
// (see bot/models/security.py) — so the pitch line below states the plan
// ladder without asserting this user's rate or fabricating a $ figure.
const STANDARD_FEE_RATE = 0.01
const PRO_FEE_RATE = 0.005
const PRICING_URL = 'https://suwappu.bot/pricing'

export function SwapPanel() {
  const { isAuthenticated, isExternalWallet, externalChain } = useAuth()
  const { side, setSide, pendingSwapAmount, setPendingSwapAmount } = useTrading()
  const { selectedPair, setSelectedPair } = usePair()
  const [activeTab, setActiveTab] = useState<OrderTab>('swap')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = usePersistentState('slippage', 0.5)
  // Solana priority-fee tier — only affects the non-custodial Phantom path,
  // so it's surfaced (below) only for Solana tokens.
  const [priorityTier, setPriorityTier] = useState<SolanaPriorityTier>('normal')

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

  // Fix-oriented copy (§3.5): map the failures traders hit most often — bad
  // balance, blown slippage, a wallet rejection, a slow RPC — to a cause +
  // one-tap remedy instead of a bare "failed". Copy only: the underlying
  // error and the execution flow are untouched.
  const swapErrorCopy = (err: unknown, fallback = 'Swap failed') => {
    const raw = errMessage(err, fallback)
    const lower = raw.toLowerCase()
    // Gas-specific first: EVM's "insufficient funds for gas * price + value"
    // means the NATIVE token is short, not the sell token — a different remedy.
    if (lower.includes('insufficient') && lower.includes('gas')) {
      return raw.includes('You need at least')
        ? raw
        : 'Not enough of the native gas token to cover this transaction — top it up and retry.'
    }
    if (lower.includes('insufficient') && (lower.includes('balance') || lower.includes('funds'))) {
      return 'Insufficient balance for this swap — lower the amount or add funds to your wallet.'
    }
    if (lower.includes('slippage') || lower.includes('min received') || lower.includes('minimum received')) {
      return 'Slippage exceeded — the price moved past your tolerance. Retry with slippage raised a notch.'
    }
    // Only wallet-rejection phrasing — never claim on-chain state from a
    // string match ("cancelled" from a router can mean a broadcast tx).
    if (lower.includes('user reject') || lower.includes('user denied') || lower.includes('user cancel') || lower.includes('rejected in wallet')) {
      return "Request declined in your wallet. Retry when you're ready."
    }
    if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('rpc') || lower.includes('network error')) {
      return 'Network timed out reaching the chain — check your connection and retry.'
    }
    return raw
  }

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
        toast.error(swapErrorCopy(err, 'Wallet rejected or swap failed'))

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
        onError: (err: unknown) => toast.error(swapErrorCopy(err)),
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

      {/* TP/SL — coming soon (§3.6): a single quiet chip, not a toggleable
          ghost form. The execute endpoint only accepts quoteId today. */}
      <div className="flex justify-start">
        <TerminalStatusPill tone="neutral">TP / SL — coming soon</TerminalStatusPill>
      </div>

      {/* Quote details — skeleton while the route is in flight, then the
          real comparison rows. */}
      {quoteLoading && !quote && (
        <TerminalSkeletonText lines={3} label="Loading quote" />
      )}
      {quote && <QuoteComparison quote={quote} />}

      {/* Quote error */}
      {quoteError && (
        <div role="alert" aria-live="assertive" className="rounded bg-bear-dim px-3 py-2 text-sm text-bear">
          {swapErrorCopy(quoteError, 'Failed to get quote — check the amount and try again.')}
        </div>
      )}

      {/* Execute button (or connect/sign-in when not authenticated). Buy =
          up-fill, Sell = down-fill, dark ink text (AA-safe on both). */}
      {!isAuthenticated ? (
        <WalletConnect />
      ) : (
        <button
          onClick={isQuoteStale ? () => void refetchQuote() : handleSwap}
          disabled={!isQuoteStale && (!quote || executingAny)}
          className={`w-full py-3 text-base font-semibold rounded transition-colors disabled:opacity-50 ${
            isQuoteStale
              ? 'bg-terminal-warn/20 text-terminal-warn border border-terminal-warn/40 hover:bg-terminal-warn/30'
              : side === 'buy'
                ? 'bg-bull hover:bg-bull/80 text-terminal-on-accent disabled:bg-bull/30'
                : 'bg-bear hover:bg-bear/80 text-terminal-on-accent disabled:bg-bear/30'
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

      {/* Fee summary — extends the one fee row (no second fee source of
          truth): network estimate, plus the Pro savings pitch once a real
          USD notional exists. */}
      <div className="hairline-t pt-2 text-center text-xs tnum text-terminal-text-muted">
        <div>
          {quote
            ? `Est. network fee: ~$${quote.gasUsd.toFixed(2)}`
            : 'Enter amount for fee estimate'}
        </div>
        {quote && (
          <div className="mt-1 text-[11px] text-terminal-text-secondary">
            Swap fee by plan: Free {(STANDARD_FEE_RATE * 100).toFixed(2)}% · Pro{' '}
            {(PRO_FEE_RATE * 100).toFixed(2)}% ·{' '}
            <a
              href={PRICING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-terminal-accent underline-offset-2 transition-colors hover:text-terminal-accent-bright hover:underline"
            >
              See pricing
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
