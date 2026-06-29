import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AppLayout, AppHeader } from '../components/layout'
import { TokenInput, SwapArrow, SwapDetails, TokenSelector } from '../components/swap'
import { SwapConfirmationWithSimulation } from '../components/swap/SwapConfirmation'
import { useTokens } from '../hooks/useTokens'
import { useSwapQuote } from '../hooks/useSwapQuote'
import { useSwapExecute } from '../hooks/useSwapExecute'
import { api } from '../lib/api'
import a11yToast from '../lib/a11yToast'
import type { SwapToken, SwapExecuteResult } from '../types/swap'

export function Swap() {
  const [fromAmount, setFromAmount] = useState('')
  const [fromToken, setFromToken] = useState<SwapToken | null>(null)
  const [toToken, setToToken] = useState<SwapToken | null>(null)
  const [showFromSelector, setShowFromSelector] = useState(false)
  const [showToSelector, setShowToSelector] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [swapResult, setSwapResult] = useState<SwapExecuteResult | null>(null)

  // Fetch available tokens
  const { data: tokens, isLoading: tokensLoading } = useTokens()

  // Set default tokens when loaded
  useEffect(() => {
    if (tokens && tokens.length > 0 && !fromToken) {
      const eth = tokens.find((t: SwapToken) => t.symbol === 'ETH')
      const usdc = tokens.find((t: SwapToken) => t.symbol === 'USDC')
      if (eth) setFromToken(eth)
      if (usdc) setToToken(usdc)
    }
  }, [tokens, fromToken])

  // Honor the user's saved slippage preference (stored in basis points); fall back to 0.5%
  const { data: prefsData } = useQuery({
    queryKey: ['preferences'],
    queryFn: () => api.getUserPreferences(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const slippagePct =
    prefsData?.preferences?.defaultSlippage != null
      ? prefsData.preferences.defaultSlippage / 100
      : 0.5

  // VIP tier — drives XP multiplier
  const { data: vipData } = useQuery({
    queryKey: ['vipStatus'],
    queryFn: () => api.getVipStatus(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  // Snapshot XP at confirmation time so toast reflects what was shown
  const xpAtConfirmRef = useRef(0)

  // Build quote request
  const quoteRequest = useMemo(() => {
    if (!fromToken || !toToken || !fromAmount) return null
    return {
      fromToken: fromToken.address,
      toToken: toToken.address,
      fromChain: fromToken.chain,
      toChain: toToken.chain,
      amount: fromAmount,
      fromDecimals: fromToken.decimals,
      slippage: slippagePct,
    }
  }, [fromToken, toToken, fromAmount, slippagePct])

  // Fetch quote (debounced)
  const { 
    data: quote, 
    isLoading: quoteLoading, 
    error: quoteError,
    isFetching: quoteFetching,
  } = useSwapQuote(quoteRequest)

  // Estimated XP: 1 XP per dollar, scaled by tier multiplier
  const estimatedXp = useMemo(
    () => Math.round((quote?.fromAmountUsd ?? 0) * (vipData?.point_multiplier ?? 1)),
    [quote?.fromAmountUsd, vipData?.point_multiplier]
  )

  // Swap execution mutation
  const {
    mutate: executeSwap,
    isPending: swapPending,
    error: swapError,
    reset: resetSwapState,
  } = useSwapExecute()

  // 'signed' = tx signed but broadcast failed server-side; it never progresses, so stop polling
  const TERMINAL_STATUSES = ['completed', 'failed', 'success', 'cancelled', 'signed']

  // Poll for swap status after execution
  const { data: swapStatus } = useQuery({
    queryKey: ['swapStatus', swapResult?.swapId],
    queryFn: () => api.getSwapStatus(swapResult!.swapId),
    enabled: !!swapResult?.swapId,
    // refetchInterval callback receives the Query object in React Query v5;
    // return false to stop polling once a terminal status is reached.
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return TERMINAL_STATUSES.includes(status ?? '') ? false : 5000
    },
    refetchIntervalInBackground: false,
  })

  const handleSwapTokens = () => {
    const temp = fromToken
    setFromToken(toToken)
    setToToken(temp)
    setFromAmount(quote?.toAmount || '')
  }

  const handleFromTokenSelect = (token: SwapToken) => {
    setFromToken(token)
    setShowFromSelector(false)
  }

  const handleToTokenSelect = (token: SwapToken) => {
    setToToken(token)
    setShowToSelector(false)
  }

  const handleReview = () => {
    xpAtConfirmRef.current = estimatedXp
    setIsConfirming(true)
  }

  const handleConfirm = () => {
    if (!quote) return

    executeSwap(
      { quoteId: quote.id },
      {
        onSuccess: (result) => {
          setIsConfirming(false)
          setSwapResult(result as SwapExecuteResult)
          setIsSuccess(true)
          if (xpAtConfirmRef.current > 0) {
            a11yToast.success(`+${xpAtConfirmRef.current} XP earned`)
          }
        },
        onError: () => {
          // Keep confirmation open so user can see the error or retry
        },
      }
    )
  }

  const handleReset = () => {
    setIsSuccess(false)
    setSwapResult(null)
    setFromAmount('')
    resetSwapState()
  }

  // Format display values
  const toAmount = quote?.toAmount || ''
  const fromUsdValue = quote ? `~$${quote.fromAmountUsd.toFixed(2)}` : undefined
  const toUsdValue = quote ? `~$${quote.toAmountUsd.toFixed(2)}` : undefined
  const exchangeRate = quote && fromToken && toToken 
    ? `1 ${fromToken.symbol} = ${quote.exchangeRate.toFixed(4)} ${toToken.symbol}`
    : undefined
  const priceImpact = quote ? `${quote.priceImpact.toFixed(2)}%` : undefined
  const networkFee = quote ? `~$${quote.gasUsd.toFixed(2)}` : undefined

  // Convert SwapToken to Token for TokenInput
  const fromTokenDisplay = fromToken ? {
    symbol: fromToken.symbol,
    logoUrl: fromToken.logoUrl,
    name: fromToken.name,
  } : { symbol: 'Select', name: 'Select token' }

  const toTokenDisplay = toToken ? {
    symbol: toToken.symbol,
    logoUrl: toToken.logoUrl,
    name: toToken.name,
  } : { symbol: 'Select', name: 'Select token' }

  const header = <AppHeader title="Swap" />

  // Determine current swap status from polling or initial result
  const currentStatus = swapStatus?.status || swapResult?.status || 'submitted'
  const txHash = swapResult?.txHash || swapStatus?.txHash
  const explorerUrl = swapResult?.explorerUrl

  // Success state
  if (isSuccess) {
    const isCompleted = currentStatus === 'completed'
    const isFailed = currentStatus === 'failed'
    const isConfirmingTx = currentStatus === 'submitted'

    return (
      <AppLayout header={header} activeNav="swap">
        <div className="p-3 pb-20 flex flex-col items-center justify-center min-h-[60vh]">
          <div className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-2 text-center max-w-xs">
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
              isFailed ? 'bg-suwappu-error/20' : isConfirmingTx ? 'bg-suwappu-gradient' : 'bg-suwappu-success/20'
            }`}>
              {isFailed ? (
                <svg className="w-8 h-8 text-suwappu-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : isConfirmingTx ? (
                <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-suwappu-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">
              {isFailed ? 'Swap Failed' : isConfirmingTx ? 'Confirming...' : 'Swap Complete!'}
            </h3>
            <p className="text-xs text-suwappu-text-secondary mb-2">
              {isFailed
                ? `Failed to swap ${fromAmount} ${fromToken?.symbol}`
                : isCompleted
                ? `Successfully swapped ${fromAmount} ${fromToken?.symbol} for ${toAmount} ${toToken?.symbol}`
                : `Swapping ${fromAmount} ${fromToken?.symbol} for ${toToken?.symbol}...`}
            </p>
            {txHash && (
              <p className="text-xs text-suwappu-text-secondary mb-4 font-mono">
                Tx: {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </p>
            )}
            <div className="space-y-2">
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full px-4 py-2 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button text-center"
                >
                  View Transaction
                </a>
              )}
              <button
                onClick={handleReset}
                className="w-full px-4 py-2 text-suwappu-magenta-mid font-heading font-semibold text-sm"
              >
                Swap Again
              </button>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  // Pending state
  if (swapPending) {
    return (
      <AppLayout header={header} activeNav="swap">
        <div className="p-3 pb-20 flex flex-col items-center justify-center min-h-[60vh]">
          <div className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-2 text-center max-w-xs">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-suwappu-gradient flex items-center justify-center">
              <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">Swap in Progress</h3>
            <p className="text-xs text-suwappu-text-secondary mb-4">
              Swapping {fromAmount} {fromToken?.symbol} for {toToken?.symbol}...
            </p>
            <div className="w-full h-1.5 bg-suwappu-sakura-light rounded-full overflow-hidden">
              <div className="h-full bg-suwappu-gradient animate-pulse w-2/3" />
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  // Confirmation modal — simulation-powered bottom sheet overlay
  // (Rendered alongside the main layout below, not as a replacement)

  // Token selector modals
  if (showFromSelector) {
    return (
      <AppLayout header={<AppHeader title="Select Token" />} activeNav="swap">
        <div className="p-3 pb-20">
          <TokenSelector
            selectedToken={fromToken}
            onSelect={handleFromTokenSelect}
            excludeAddresses={toToken ? [toToken.address] : []}
          />
          <button
            onClick={() => setShowFromSelector(false)}
            className="w-full mt-4 px-4 py-3 bg-white text-suwappu-text-secondary font-heading font-bold text-sm rounded-suwappu-pill border border-suwappu-sakura-mid"
          >
            Cancel
          </button>
        </div>
      </AppLayout>
    )
  }

  if (showToSelector) {
    return (
      <AppLayout header={<AppHeader title="Select Token" />} activeNav="swap">
        <div className="p-3 pb-20">
          <TokenSelector
            selectedToken={toToken}
            onSelect={handleToTokenSelect}
            excludeAddresses={fromToken ? [fromToken.address] : []}
          />
          <button
            onClick={() => setShowToSelector(false)}
            className="w-full mt-4 px-4 py-3 bg-white text-suwappu-text-secondary font-heading font-bold text-sm rounded-suwappu-pill border border-suwappu-sakura-mid"
          >
            Cancel
          </button>
        </div>
      </AppLayout>
    )
  }

  // Determine button state
  const canSwap = fromToken && toToken && fromAmount && parseFloat(fromAmount) > 0 && quote && !quoteLoading
  const buttonText = !fromToken || !toToken 
    ? 'Select tokens'
    : !fromAmount || parseFloat(fromAmount) <= 0
    ? 'Enter amount'
    : quoteFetching
    ? 'Getting quote...'
    : quoteError
    ? 'Quote unavailable'
    : 'Review Swap'

  // Main swap form
  return (
    <>
      <AppLayout header={header} activeNav="swap">
        <div className="p-3 pb-20 space-y-1">
          {tokensLoading ? (
            <div className="bg-white rounded-suwappu-xl p-6 shadow-suwappu-1 text-center">
              <div className="animate-pulse">Loading tokens...</div>
            </div>
          ) : (
            <>
              <TokenInput
                label="From"
                amount={fromAmount}
                onAmountChange={setFromAmount}
                token={fromTokenDisplay}
                onTokenClick={() => setShowFromSelector(true)}
                balance={fromToken?.balance}
                usdValue={fromUsdValue}
              />

              {/* Amount preset buttons */}
              {fromToken?.balance && parseFloat(fromToken.balance) > 0 && (
                <div className="flex justify-end gap-2 px-1 -mt-1 mb-1">
                  <button
                    onClick={() => setFromAmount((parseFloat(fromToken.balance!) * 0.25).toString())}
                    className="px-2 py-0.5 text-xs font-semibold text-suwappu-magenta-mid bg-suwappu-sakura-light rounded-full hover:bg-suwappu-sakura-mid transition-colors"
                  >
                    25%
                  </button>
                  <button
                    onClick={() => setFromAmount((parseFloat(fromToken.balance!) * 0.5).toString())}
                    className="px-2 py-0.5 text-xs font-semibold text-suwappu-magenta-mid bg-suwappu-sakura-light rounded-full hover:bg-suwappu-sakura-mid transition-colors"
                  >
                    50%
                  </button>
                  <button
                    onClick={() => setFromAmount(fromToken.balance!)}
                    className="px-2 py-0.5 text-xs font-semibold text-suwappu-magenta-mid bg-suwappu-sakura-light rounded-full hover:bg-suwappu-sakura-mid transition-colors"
                  >
                    MAX
                  </button>
                </div>
              )}

              <SwapArrow onClick={handleSwapTokens} />

              <TokenInput
                label="To"
                amount={quoteFetching ? '...' : toAmount}
                onAmountChange={() => {}}
                token={toTokenDisplay}
                onTokenClick={() => setShowToSelector(true)}
                usdValue={toUsdValue}
                readOnly
              />

              {/* Quote loading indicator */}
              {quoteFetching && (
                <div className="text-center py-2">
                  <span className="text-xs text-suwappu-text-secondary animate-pulse">
                    Fetching best rate...
                  </span>
                </div>
              )}

              {/* Quote error */}
              {quoteError && (
                <div className="bg-suwappu-error/10 rounded-suwappu-lg p-3 text-center">
                  <span className="text-xs text-suwappu-error">
                    {(quoteError as { detail?: string })?.detail || 'Failed to get quote'}
                  </span>
                </div>
              )}

              {/* Swap error */}
              {swapError && (
                <div className="bg-suwappu-error/10 rounded-suwappu-lg p-3 text-center">
                  <span className="text-xs text-suwappu-error">
                    {(swapError as { detail?: string })?.detail || 'Swap failed'}
                  </span>
                </div>
              )}

              {quote && !quoteFetching && (
                <div className="mt-4">
                  <SwapDetails
                    rate={exchangeRate}
                    priceImpact={priceImpact}
                    networkFee={networkFee}
                    route={quote.route}
                  />
                </div>
              )}

              <button
                onClick={handleReview}
                disabled={!canSwap}
                className="w-full px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {buttonText}
              </button>
            </>
          )}
        </div>
      </AppLayout>

      {/* Transaction simulation preview — bottom sheet overlay */}
      {isConfirming && quote && fromToken && toToken && (
        <SwapConfirmationWithSimulation
          quote={quote}
          fromToken={fromToken}
          toToken={toToken}
          onConfirm={handleConfirm}
          onCancel={() => setIsConfirming(false)}
          isExecuting={swapPending}
          estimatedXp={estimatedXp}
        />
      )}
    </>
  )
}
