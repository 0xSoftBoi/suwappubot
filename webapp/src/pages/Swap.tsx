import { useState, useEffect, useMemo } from 'react'
import { AppLayout, AppHeader } from '../components/layout'
import { TokenInput, SwapArrow, SwapDetails, TokenSelector } from '../components/swap'
import { useTokens } from '../hooks/useTokens'
import { useSwapQuote } from '../hooks/useSwapQuote'
import { useSwapExecute } from '../hooks/useSwapExecute'
import type { SwapToken } from '../types/swap'

export function Swap() {
  const [fromAmount, setFromAmount] = useState('')
  const [fromToken, setFromToken] = useState<SwapToken | null>(null)
  const [toToken, setToToken] = useState<SwapToken | null>(null)
  const [showFromSelector, setShowFromSelector] = useState(false)
  const [showToSelector, setShowToSelector] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

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
      slippage: 0.5,
    }
  }, [fromToken, toToken, fromAmount])

  // Fetch quote (debounced)
  const { 
    data: quote, 
    isLoading: quoteLoading, 
    error: quoteError,
    isFetching: quoteFetching,
  } = useSwapQuote(quoteRequest)

  // Swap execution mutation
  const {
    mutate: executeSwap,
    isPending: swapPending,
    error: swapError,
    reset: resetSwapState,
  } = useSwapExecute()

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
    setIsConfirming(true)
  }

  const handleConfirm = () => {
    if (!quote) return

    setIsConfirming(false)
    executeSwap(
      { quoteId: quote.id },
      {
        onSuccess: () => {
          setIsSuccess(true)
        },
      }
    )
  }

  const handleReset = () => {
    setIsSuccess(false)
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
  const minReceived = quote && toToken ? `${quote.minReceived} ${toToken.symbol}` : undefined

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

  // Success state
  if (isSuccess) {
    return (
      <AppLayout header={header} activeNav="swap">
        <div className="p-3 pb-20 flex flex-col items-center justify-center min-h-[60vh]">
          <div className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-2 text-center max-w-xs">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-suwappu-success/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-suwappu-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">Swap Complete!</h3>
            <p className="text-xs text-suwappu-text-secondary mb-4">
              Successfully swapped {fromAmount} {fromToken?.symbol} for {toAmount} {toToken?.symbol}
            </p>
            <div className="space-y-2">
              <button className="w-full px-4 py-2 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button">
                View Transaction
              </button>
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

  // Confirmation modal
  if (isConfirming && quote) {
    return (
      <AppLayout header={<AppHeader title="Confirm Swap" />} activeNav="swap">
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
            <div className="flex items-center justify-center gap-4 mb-4">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl mb-1 overflow-hidden">
                  {fromToken?.logoUrl ? (
                    <img src={fromToken.logoUrl} alt={fromToken.symbol} className="w-full h-full object-cover" />
                  ) : (
                    fromToken?.symbol.slice(0, 2)
                  )}
                </div>
                <span className="font-heading font-bold text-lg text-suwappu-text">{fromAmount}</span>
                <span className="text-xs text-suwappu-text-secondary block">{fromToken?.symbol}</span>
              </div>
              <svg className="w-6 h-6 text-suwappu-magenta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl mb-1 overflow-hidden">
                  {toToken?.logoUrl ? (
                    <img src={toToken.logoUrl} alt={toToken.symbol} className="w-full h-full object-cover" />
                  ) : (
                    toToken?.symbol.slice(0, 2)
                  )}
                </div>
                <span className="font-heading font-bold text-lg text-suwappu-text">{toAmount}</span>
                <span className="text-xs text-suwappu-text-secondary block">{toToken?.symbol}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2">Transaction Details</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Rate</span>
                <span className="text-suwappu-text">{exchangeRate}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Min. Received</span>
                <span className="text-suwappu-text">{minReceived}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Slippage</span>
                <span className="text-suwappu-text">{quote.slippage}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Network Fee</span>
                <span className="text-suwappu-text">{networkFee}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setIsConfirming(false)}
              className="px-4 py-3 bg-white text-suwappu-text-secondary font-heading font-bold text-sm rounded-suwappu-pill border border-suwappu-sakura-mid"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button"
            >
              Confirm
            </button>
          </div>
        </div>
      </AppLayout>
    )
  }

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
  )
}
