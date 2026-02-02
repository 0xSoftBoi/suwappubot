import { useState, useEffect, useMemo } from 'react'
import { AppLayout, AppHeader } from '../components/layout'
import { TokenInput, SwapArrow, SwapDetails, TokenSelector } from '../components/swap'
import { ChainSelector, defaultChains, SkeletonCard, QuoteSkeleton } from '../components/ui'
import { useTokens } from '../hooks/useTokens'
import { useSwapQuote } from '../hooks/useSwapQuote'
import { useSwapExecute, useSwapStatus } from '../hooks/useSwapExecute'
import { useHaptic } from '../hooks/useHaptic'
import { parseAmountInput, toSmallestUnit } from '../lib/amount-parser'
import type { SwapToken } from '../types/swap'

export function Swap() {
  const haptic = useHaptic()
  const [selectedChain, setSelectedChain] = useState('1') // Default to Ethereum
  const [fromAmount, setFromAmount] = useState('')
  const [fromToken, setFromToken] = useState<SwapToken | null>(null)
  const [toToken, setToToken] = useState<SwapToken | null>(null)
  const [showFromSelector, setShowFromSelector] = useState(false)
  const [showToSelector, setShowToSelector] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [activeSwapId, setActiveSwapId] = useState<number | null>(null)
  const [activeTxHash, setActiveTxHash] = useState<string | null>(null)

  // Poll swap status after execution
  const { data: swapStatus } = useSwapStatus(activeSwapId)

  // Transition to success when swap completes
  useEffect(() => {
    if (swapStatus?.status === 'completed') {
      setIsSuccess(true)
      setActiveSwapId(null)
    }
  }, [swapStatus?.status])

  // Fetch available tokens for selected chain
  const { data: tokens, isLoading: tokensLoading } = useTokens(selectedChain)

  // Set default tokens when loaded or chain changes
  useEffect(() => {
    if (tokens && tokens.length > 0) {
      // Find native token (ETH on mainnet, MATIC on Polygon, etc.) and USDC
      const nativeToken = tokens.find((t: SwapToken) => 
        t.symbol === 'ETH' || t.symbol === 'MATIC' || t.symbol === 'WETH'
      )
      const usdc = tokens.find((t: SwapToken) => t.symbol === 'USDC')
      
      // Only set if current tokens don't exist on new chain
      const fromTokenExists = fromToken && tokens.some((t: SwapToken) => t.address === fromToken.address)
      const toTokenExists = toToken && tokens.some((t: SwapToken) => t.address === toToken.address)
      
      if (!fromTokenExists && nativeToken) setFromToken(nativeToken)
      if (!toTokenExists && usdc) setToToken(usdc)
    }
  }, [tokens, selectedChain])

  // Handle chain selection
  const handleChainSelect = (chainId: string) => {
    haptic.selection()
    setSelectedChain(chainId)
    // Reset tokens when chain changes - they'll be set by the effect above
    setFromToken(null)
    setToToken(null)
    setFromAmount('')
  }

  // Parse and normalize amount input (handles "0.5", "1,000", "$50", etc.)
  const parsedAmount = useMemo(() => {
    if (!fromAmount) return null
    return parseAmountInput(fromAmount, fromToken?.decimals || 18)
  }, [fromAmount, fromToken?.decimals])

  // Build quote request
  const quoteRequest = useMemo(() => {
    if (!fromToken || !toToken || !parsedAmount?.value) return null
    
    const amountNum = parseFloat(parsedAmount.value)
    if (isNaN(amountNum) || amountNum <= 0) return null
    
    // If it looks like raw wei, use directly; otherwise convert
    const amountInSmallestUnit = parsedAmount.isRawUnit 
      ? parsedAmount.value
      : toSmallestUnit(parsedAmount.value, fromToken.decimals)
    
    // TODO: If fiat amount, convert using token price
    // if (parsedAmount.isFiat) { ... }
    
    return {
      fromToken: fromToken.address,
      toToken: toToken.address,
      fromChain: fromToken.chain,
      toChain: toToken.chain,
      amount: amountInSmallestUnit,
      fromDecimals: fromToken.decimals,
      slippage: 0.5,
    }
  }, [fromToken, toToken, parsedAmount])

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
      { quoteId: quote.quoteId },
      {
        onSuccess: (result) => {
          setActiveTxHash(result.txHash)
          if (result.txHash) {
            // Transaction broadcast — poll for completion
            setActiveSwapId(result.swapId)
          } else {
            // No broadcast (signed only) — show success immediately
            setIsSuccess(true)
          }
        },
      }
    )
  }

  const handleReset = () => {
    setIsSuccess(false)
    setActiveSwapId(null)
    setActiveTxHash(null)
    setFromAmount('')
    resetSwapState()
  }

  // Format display values
  const toAmount = quote?.toAmount || ''
  const fromUsdValue = quote?.fromAmountUsd != null ? `~$${Number(quote.fromAmountUsd).toFixed(2)}` : undefined
  const toUsdValue = quote?.toAmountUsd != null ? `~$${Number(quote.toAmountUsd).toFixed(2)}` : undefined
  const exchangeRate = quote && fromToken && toToken
    ? `1 ${fromToken.symbol} = ${parseFloat(quote.exchangeRate).toFixed(4)} ${toToken.symbol}`
    : undefined
  const priceImpact = quote ? `${parseFloat(quote.priceImpact).toFixed(2)}%` : undefined
  const networkFee = quote ? `~$${quote.estimatedGasUsd}` : undefined
  const minReceived = quote && toToken
    ? `${(parseFloat(quote.toAmountMin) / Math.pow(10, toToken.decimals)).toFixed(6)} ${toToken.symbol}`
    : undefined

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

  // Explorer URL helper
  const getExplorerUrl = (txHash: string, chainId: string) => {
    const explorers: Record<string, string> = {
      '1': 'https://etherscan.io/tx/',
      '10': 'https://optimistic.etherscan.io/tx/',
      '56': 'https://bscscan.com/tx/',
      '137': 'https://polygonscan.com/tx/',
      '8453': 'https://basescan.org/tx/',
      '42161': 'https://arbiscan.io/tx/',
      '43114': 'https://snowtrace.io/tx/',
      '59144': 'https://lineascan.build/tx/',
      '324': 'https://explorer.zksync.io/tx/',
    }
    return `${explorers[chainId] || 'https://etherscan.io/tx/'}${txHash}`
  }

  const displayTxHash = activeTxHash || swapStatus?.txHash
  const header = <AppHeader title="Swap" />

  // Success state
  if (isSuccess) {
    return (
      <AppLayout header={header} activeNav="swap">
        <div className="p-3 pb-20 flex flex-col items-center justify-center min-h-[60vh]" role="alert" aria-live="assertive">
          <div className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-2 text-center max-w-xs">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-suwappu-success/20 flex items-center justify-center" aria-hidden="true">
              <svg className="w-8 h-8 text-suwappu-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">Swap Complete!</h3>
            <p className="text-xs text-suwappu-text-secondary mb-4">
              Successfully swapped {fromAmount} {fromToken?.symbol} for {toAmount} {toToken?.symbol}
            </p>
            {displayTxHash && (
              <p className="text-xs text-suwappu-text-secondary mb-4 font-mono truncate">
                Tx: {displayTxHash.slice(0, 10)}...{displayTxHash.slice(-8)}
              </p>
            )}
            <div className="space-y-2">
              {displayTxHash && (
                <a
                  href={getExplorerUrl(displayTxHash, selectedChain)}
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

  // Pending/polling state — either executing or waiting for on-chain confirmation
  if (swapPending || activeSwapId != null) {
    const statusLabel = swapPending
      ? 'Signing transaction...'
      : swapStatus?.status === 'submitted'
      ? 'Waiting for confirmation...'
      : swapStatus?.status === 'failed'
      ? 'Swap failed'
      : 'Processing swap...'

    // If swap failed during polling, show error with reset option
    if (swapStatus?.status === 'failed') {
      return (
        <AppLayout header={header} activeNav="swap">
          <div className="p-3 pb-20 flex flex-col items-center justify-center min-h-[60vh]">
            <div className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-2 text-center max-w-xs">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-suwappu-error/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-suwappu-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">Swap Failed</h3>
              <p className="text-xs text-suwappu-text-secondary mb-4">
                {swapStatus.errorMessage || 'The swap transaction failed.'}
              </p>
              <button
                onClick={handleReset}
                className="w-full px-4 py-2 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button"
              >
                Try Again
              </button>
            </div>
          </div>
        </AppLayout>
      )
    }

    return (
      <AppLayout header={header} activeNav="swap">
        <div className="p-3 pb-20 flex flex-col items-center justify-center min-h-[60vh]" role="status" aria-live="polite">
          <div className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-2 text-center max-w-xs">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-suwappu-gradient flex items-center justify-center" aria-hidden="true">
              <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">Swap in Progress</h3>
            <p className="text-xs text-suwappu-text-secondary mb-2">
              Swapping {fromAmount} {fromToken?.symbol} for {toToken?.symbol}...
            </p>
            <p className="text-xs text-suwappu-magenta-mid mb-4" aria-live="assertive">{statusLabel}</p>
            {displayTxHash && (
              <a
                href={getExplorerUrl(displayTxHash, selectedChain)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-suwappu-magenta-mid underline mb-4 block"
              >
                View on Explorer
              </a>
            )}
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
            chain={selectedChain}
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
            chain={selectedChain}
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
        {/* Chain Selector */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1 mb-2">
          <span className="text-xs text-suwappu-text-secondary mb-2 block">Network</span>
          <ChainSelector
            chains={defaultChains}
            selected={selectedChain}
            onSelect={handleChainSelect}
          />
        </div>

        {tokensLoading ? (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={2} variant="token" />
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
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 mt-4">
                <QuoteSkeleton />
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
