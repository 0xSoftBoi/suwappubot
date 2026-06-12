import { useState, useEffect, useMemo } from 'react'
import { useTokens } from './useTokens'
import { useSwapQuote } from './useSwapQuote'
import { useSwapExecute, useSwapStatus } from './useSwapExecute'
import { useHaptic } from './useHaptic'
import { parseAmountInput, toSmallestUnit } from '../lib/amount-parser'
import type { SwapToken } from '../types/swap'

// Explorer URL helper
const EXPLORERS: Record<string, string> = {
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

export function getExplorerUrl(txHash: string, chainId: string) {
  return `${EXPLORERS[chainId] || 'https://etherscan.io/tx/'}${txHash}`
}

export function useSwapForm() {
  const haptic = useHaptic()
  const [selectedChain, setSelectedChain] = useState('1')
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
  const { data: swapStatus } = useSwapStatus(activeSwapId === null ? null : String(activeSwapId))

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
      const nativeToken = tokens.find((t: SwapToken) =>
        t.symbol === 'ETH' || t.symbol === 'MATIC' || t.symbol === 'WETH'
      )
      const usdc = tokens.find((t: SwapToken) => t.symbol === 'USDC')

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
    setFromToken(null)
    setToToken(null)
    setFromAmount('')
  }

  // Parse and normalize amount input
  const parsedAmount = useMemo(() => {
    if (!fromAmount) return null
    return parseAmountInput(fromAmount, fromToken?.decimals || 18)
  }, [fromAmount, fromToken?.decimals])

  // Build quote request
  const quoteRequest = useMemo(() => {
    if (!fromToken || !toToken || !parsedAmount?.value) return null

    const amountNum = parseFloat(parsedAmount.value)
    if (isNaN(amountNum) || amountNum <= 0) return null

    const amountInSmallestUnit = parsedAmount.isRawUnit
      ? parsedAmount.value
      : toSmallestUnit(parsedAmount.value, fromToken.decimals)

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
      { quoteId: quote.id },
      {
        onSuccess: (result) => {
          setActiveTxHash(result.txHash ?? null)
          if (result.txHash) {
            setActiveSwapId(result.swapId)
          } else {
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
    ? `1 ${fromToken.symbol} = ${Number(quote.exchangeRate).toFixed(4)} ${toToken.symbol}`
    : undefined
  const priceImpact = quote ? `${Number(quote.priceImpact).toFixed(2)}%` : undefined
  const networkFee = quote ? `~$${quote.gasUsd}` : undefined
  const minReceived = quote && toToken
    ? `${(parseFloat(quote.minReceived) / Math.pow(10, toToken.decimals)).toFixed(6)} ${toToken.symbol}`
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

  const displayTxHash = activeTxHash || swapStatus?.txHash

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

  return {
    // State
    selectedChain,
    fromAmount,
    fromToken,
    toToken,
    showFromSelector,
    showToSelector,
    isConfirming,
    isSuccess,
    activeSwapId,
    activeTxHash,
    swapStatus,
    tokensLoading,
    quote,
    quoteLoading,
    quoteError,
    quoteFetching,
    swapPending,
    swapError,

    // Display values
    toAmount,
    fromUsdValue,
    toUsdValue,
    exchangeRate,
    priceImpact,
    networkFee,
    minReceived,
    fromTokenDisplay,
    toTokenDisplay,
    displayTxHash,
    canSwap,
    buttonText,

    // Setters
    setFromAmount,
    setShowFromSelector,
    setShowToSelector,
    setIsConfirming,

    // Handlers
    handleChainSelect,
    handleSwapTokens,
    handleFromTokenSelect,
    handleToTokenSelect,
    handleReview,
    handleConfirm,
    handleReset,
  }
}
