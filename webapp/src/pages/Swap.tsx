import { useState } from 'react'
import { AppLayout, AppHeader } from '../components/layout'
import { TokenInput, SwapArrow, SwapDetails } from '../components/swap'
import { ChainSelector } from '../components/ui'
import { useQuote, formatTokenAmount } from '../hooks'

const chains = [
  { id: 'ethereum', name: 'Ethereum', icon: 'Ξ' },
  { id: 'bsc', name: 'BSC', icon: '🔶' },
  { id: 'polygon', name: 'Polygon', icon: '⬡' },
  { id: 'arbitrum', name: 'Arbitrum', icon: '🔵' },
  { id: 'optimism', name: 'Optimism', icon: '🔴' },
  { id: 'base', name: 'Base', icon: '🔷' },
  { id: 'solana', name: 'Solana', icon: '◎' },
]

const defaultFromToken = { symbol: 'ETH', icon: 'Ξ', name: 'Ethereum' }
const defaultToToken = { symbol: 'USDC', icon: '$', name: 'USD Coin' }

export function Swap() {
  const [fromAmount, setFromAmount] = useState('0.5')
  const [fromToken, setFromToken] = useState(defaultFromToken)
  const [toToken, setToToken] = useState(defaultToToken)
  const [fromChain, setFromChain] = useState('ethereum')
  const [toChain, setToChain] = useState('ethereum')
  const [isConfirming, setIsConfirming] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  const isCrossChain = fromChain !== toChain

  // Fetch quote from API
  const { data: quote, isLoading: quoteLoading, error: quoteError } = useQuote({
    fromChain,
    toChain,
    fromToken: fromToken.symbol,
    toToken: toToken.symbol,
    fromAmount,
    slippage: 0.5,
    enabled: parseFloat(fromAmount || '0') > 0,
  })

  // Computed values from quote
  const toAmount = quote
    ? formatTokenAmount(quote.toAmount, quote.toToken.decimals)
    : ''
  const toAmountMin = quote
    ? formatTokenAmount(quote.toAmountMin, quote.toToken.decimals)
    : ''
  const rate = quote
    ? `1 ${fromToken.symbol} = ${(parseFloat(quote.toAmountUSD) / parseFloat(quote.fromAmountUSD) * parseFloat(fromAmount) / parseFloat(toAmount || '1')).toFixed(2)} ${toToken.symbol}`
    : `1 ${fromToken.symbol} = -- ${toToken.symbol}`
  const networkFee = quote
    ? `~$${parseFloat(quote.estimatedGasUSD).toFixed(2)}`
    : isCrossChain ? '~$5.00' : '~$2.50'
  const priceImpact = quote?.priceImpact
    ? `${parseFloat(quote.priceImpact).toFixed(2)}%`
    : '<0.01%'
  const fromUsdValue = quote?.fromAmountUSD
    ? `~$${parseFloat(quote.fromAmountUSD).toFixed(2)}`
    : ''
  const toUsdValue = quote?.toAmountUSD
    ? `~$${parseFloat(quote.toAmountUSD).toFixed(2)}`
    : ''

  const handleSwapTokens = () => {
    const tempToken = fromToken
    setFromToken(toToken)
    setToToken(tempToken)
    // When swapping, set fromAmount to the current toAmount if we have a quote
    if (toAmount) {
      setFromAmount(toAmount)
    }
    const tempChain = fromChain
    setFromChain(toChain)
    setToChain(tempChain)
  }

  const handleReview = () => {
    setIsConfirming(true)
  }

  const handleConfirm = async () => {
    setIsConfirming(false)
    setIsPending(true)
    // Simulate swap
    await new Promise(resolve => setTimeout(resolve, 3000))
    setIsPending(false)
    setIsSuccess(true)
  }

  const handleReset = () => {
    setIsSuccess(false)
    setFromAmount('')
  }

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
              Successfully swapped {fromAmount} {fromToken.symbol} for {toAmount} {toToken.symbol}
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
  if (isPending) {
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
              Swapping {fromAmount} {fromToken.symbol} for {toToken.symbol}...
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
  if (isConfirming) {
    return (
      <AppLayout header={<AppHeader title="Confirm Swap" />} activeNav="swap">
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
            <div className="flex items-center justify-center gap-4 mb-4">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl mb-1">
                  {fromToken.icon}
                </div>
                <span className="font-heading font-bold text-lg text-suwappu-text">{fromAmount}</span>
                <span className="text-xs text-suwappu-text-secondary block">{fromToken.symbol}</span>
              </div>
              <svg className="w-6 h-6 text-suwappu-magenta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl mb-1">
                  {toToken.icon}
                </div>
                <span className="font-heading font-bold text-lg text-suwappu-text">{toAmount}</span>
                <span className="text-xs text-suwappu-text-secondary block">{toToken.symbol}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2">Transaction Details</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Rate</span>
                <span className="text-suwappu-text">{rate}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Min. Received</span>
                <span className="text-suwappu-text">{toAmountMin || toAmount} {toToken.symbol}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Slippage</span>
                <span className="text-suwappu-text">0.5%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Network Fee</span>
                <span className="text-suwappu-text">{networkFee}</span>
              </div>
              {quote?.executionDuration && (
                <div className="flex items-center justify-between">
                  <span className="text-suwappu-text-secondary">Est. Time</span>
                  <span className="text-suwappu-text">~{Math.ceil(quote.executionDuration / 60)} min</span>
                </div>
              )}
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

  // Main swap form
  return (
    <AppLayout header={header} activeNav="swap">
      <div className="p-3 pb-20 space-y-3">
        {/* Cross-chain indicator */}
        {isCrossChain && (
          <div className="bg-suwappu-info/10 border border-suwappu-info/20 rounded-suwappu-lg p-2 flex items-center gap-2">
            <span className="text-lg">🌉</span>
            <p className="text-xs text-suwappu-info font-medium">
              Cross-chain swap via Li.Fi
            </p>
          </div>
        )}

        {/* From section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-suwappu-text-secondary font-medium">From Chain</span>
          </div>
          <ChainSelector
            chains={chains}
            selected={fromChain}
            onSelect={setFromChain}
          />
          <TokenInput
            label="From"
            amount={fromAmount}
            onAmountChange={setFromAmount}
            token={fromToken}
            balance="0.5432"
            usdValue={fromUsdValue || '~$0.00'}
          />
        </div>

        <SwapArrow onClick={handleSwapTokens} />

        {/* To section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-suwappu-text-secondary font-medium">To Chain</span>
          </div>
          <ChainSelector
            chains={chains}
            selected={toChain}
            onSelect={setToChain}
          />
          <TokenInput
            label="To"
            amount={quoteLoading ? '...' : toAmount}
            onAmountChange={() => {}}
            token={toToken}
            usdValue={toUsdValue || '~$0.00'}
            readOnly
          />
        </div>

        {quoteError && (
          <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-2">
            <p className="text-xs text-suwappu-error font-medium">
              Failed to get quote. Please try again.
            </p>
          </div>
        )}

        <SwapDetails
          rate={quoteLoading ? 'Loading...' : rate}
          priceImpact={priceImpact}
          networkFee={networkFee}
          route={quote?.route?.bridgeUsed ? `Via ${quote.route.bridgeUsed}` : (isCrossChain ? 'Via Li.Fi Bridge' : 'Via Li.Fi')}
        />

        <button
          onClick={handleReview}
          disabled={!fromAmount || fromAmount === '0' || quoteLoading || !quote || !!quoteError}
          className="w-full px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {quoteLoading ? 'Getting Quote...' : (isCrossChain ? 'Review Cross-Chain Swap' : 'Review Swap')}
        </button>
      </div>
    </AppLayout>
  )
}
