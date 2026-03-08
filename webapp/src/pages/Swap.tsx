import { AppLayout, AppHeader } from '../components/layout'
import { TokenInput, SwapArrow, SwapDetails, TokenSelector } from '../components/swap'
import { ChainSelector, defaultChains, SkeletonCard, QuoteSkeleton, Confetti, TransactionProgress, AnimatedButton } from '../components/ui'
import type { TransactionStatus } from '../components/ui'
import { useSwapForm, getExplorerUrl } from '../hooks/useSwapForm'

export function Swap() {
  const swap = useSwapForm()

  const header = <AppHeader title="Swap" />

  // Success state
  if (swap.isSuccess) {
    return (
      <AppLayout header={header} activeNav="swap">
        <Confetti active={swap.isSuccess} duration={4000} pieces={60} />
        <div className="p-3 pb-20 flex flex-col items-center justify-center min-h-[60vh]" role="alert" aria-live="assertive">
          <div className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-2 text-center max-w-xs">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-suwappu-success/20 flex items-center justify-center" aria-hidden="true">
              <svg className="w-8 h-8 text-suwappu-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">Swap Complete!</h3>
            <p className="text-xs text-suwappu-text-secondary mb-4">
              Successfully swapped {swap.fromAmount} {swap.fromToken?.symbol} for {swap.toAmount} {swap.toToken?.symbol}
            </p>
            {swap.displayTxHash && (
              <p className="text-xs text-suwappu-text-secondary mb-4 font-mono truncate">
                Tx: {swap.displayTxHash.slice(0, 10)}...{swap.displayTxHash.slice(-8)}
              </p>
            )}
            <div className="space-y-2">
              {swap.displayTxHash && (
                <a
                  href={getExplorerUrl(swap.displayTxHash, swap.selectedChain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full px-4 py-2 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button text-center"
                >
                  View Transaction
                </a>
              )}
              <button
                onClick={swap.handleReset}
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

  // Pending/polling state
  if (swap.swapPending || swap.activeSwapId != null) {
    const txStatus: TransactionStatus = swap.swapPending
      ? 'submitting'
      : swap.swapStatus?.status === 'signed'
      ? 'pending'
      : swap.swapStatus?.status === 'failed'
      ? 'failed'
      : 'confirming'

    const chainName = defaultChains.find(c => c.id === swap.selectedChain)?.name.toLowerCase() || 'ethereum'

    return (
      <AppLayout header={header} activeNav="swap">
        <div className="p-3 pb-20 space-y-4" role="status" aria-live="polite">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
            <p className="text-sm text-suwappu-text-secondary mb-1">Swapping</p>
            <p className="font-heading font-bold text-lg text-suwappu-purple-deep">
              {swap.fromAmount} {swap.fromToken?.symbol} → {swap.toToken?.symbol}
            </p>
          </div>

          <TransactionProgress
            status={txStatus}
            txHash={swap.displayTxHash || undefined}
            chain={chainName}
            errorMessage={swap.swapStatus?.status === 'failed' ? swap.swapStatus.errorMessage : undefined}
            onRetry={swap.handleReset}
            onViewExplorer={swap.displayTxHash ? () => window.open(getExplorerUrl(swap.displayTxHash!, swap.selectedChain), '_blank') : undefined}
          />

          {swap.swapPending && (
            <button
              onClick={swap.handleReset}
              className="w-full px-4 py-2 text-suwappu-text-secondary font-heading font-semibold text-sm"
            >
              Cancel
            </button>
          )}
        </div>
      </AppLayout>
    )
  }

  // Confirmation modal
  if (swap.isConfirming && swap.quote) {
    return (
      <AppLayout header={<AppHeader title="Confirm Swap" />} activeNav="swap">
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
            <div className="flex items-center justify-center gap-4 mb-4">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl mb-1 overflow-hidden">
                  {swap.fromToken?.logoUrl ? (
                    <img src={swap.fromToken.logoUrl} alt={swap.fromToken.symbol} className="w-full h-full object-cover" />
                  ) : (
                    swap.fromToken?.symbol.slice(0, 2)
                  )}
                </div>
                <span className="font-heading font-bold text-lg text-suwappu-text">{swap.fromAmount}</span>
                <span className="text-xs text-suwappu-text-secondary block">{swap.fromToken?.symbol}</span>
              </div>
              <svg className="w-6 h-6 text-suwappu-magenta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-2xl mb-1 overflow-hidden">
                  {swap.toToken?.logoUrl ? (
                    <img src={swap.toToken.logoUrl} alt={swap.toToken.symbol} className="w-full h-full object-cover" />
                  ) : (
                    swap.toToken?.symbol.slice(0, 2)
                  )}
                </div>
                <span className="font-heading font-bold text-lg text-suwappu-text">{swap.toAmount}</span>
                <span className="text-xs text-suwappu-text-secondary block">{swap.toToken?.symbol}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2">Transaction Details</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Rate</span>
                <span className="text-suwappu-text">{swap.exchangeRate}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Min. Received</span>
                <span className="text-suwappu-text">{swap.minReceived}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Slippage</span>
                <span className="text-suwappu-text">{swap.quote.slippage}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-suwappu-text-secondary">Network Fee</span>
                <span className="text-suwappu-text">{swap.networkFee}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <AnimatedButton
              onClick={() => swap.setIsConfirming(false)}
              variant="secondary"
              size="lg"
              fullWidth
            >
              Cancel
            </AnimatedButton>
            <AnimatedButton
              onClick={swap.handleConfirm}
              variant="primary"
              size="lg"
              fullWidth
            >
              Confirm
            </AnimatedButton>
          </div>
        </div>
      </AppLayout>
    )
  }

  // Token selector modals
  if (swap.showFromSelector) {
    return (
      <AppLayout header={<AppHeader title="Select Token" />} activeNav="swap">
        <div className="p-3 pb-20">
          <TokenSelector
            selectedToken={swap.fromToken}
            onSelect={swap.handleFromTokenSelect}
            chain={swap.selectedChain}
            excludeAddresses={swap.toToken ? [swap.toToken.address] : []}
          />
          <button
            onClick={() => swap.setShowFromSelector(false)}
            className="w-full mt-4 px-4 py-3 bg-white text-suwappu-text-secondary font-heading font-bold text-sm rounded-suwappu-pill border border-suwappu-sakura-mid"
          >
            Cancel
          </button>
        </div>
      </AppLayout>
    )
  }

  if (swap.showToSelector) {
    return (
      <AppLayout header={<AppHeader title="Select Token" />} activeNav="swap">
        <div className="p-3 pb-20">
          <TokenSelector
            selectedToken={swap.toToken}
            onSelect={swap.handleToTokenSelect}
            chain={swap.selectedChain}
            excludeAddresses={swap.fromToken ? [swap.fromToken.address] : []}
          />
          <button
            onClick={() => swap.setShowToSelector(false)}
            className="w-full mt-4 px-4 py-3 bg-white text-suwappu-text-secondary font-heading font-bold text-sm rounded-suwappu-pill border border-suwappu-sakura-mid"
          >
            Cancel
          </button>
        </div>
      </AppLayout>
    )
  }

  // Main swap form
  return (
    <AppLayout header={header} activeNav="swap">
      <div className="p-3 pb-20 space-y-1">
        {/* Chain Selector */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1 mb-2">
          <span className="text-xs text-suwappu-text-secondary mb-2 block">Network</span>
          <ChainSelector
            chains={defaultChains}
            selected={swap.selectedChain}
            onSelect={swap.handleChainSelect}
          />
        </div>

        {swap.tokensLoading ? (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={2} variant="token" />
          </div>
        ) : (
          <>
            <TokenInput
              label="From"
              amount={swap.fromAmount}
              onAmountChange={swap.setFromAmount}
              token={swap.fromTokenDisplay}
              onTokenClick={() => swap.setShowFromSelector(true)}
              balance={swap.fromToken?.balance}
              usdValue={swap.fromUsdValue}
            />

            {/* Amount preset buttons */}
            {swap.fromToken?.balance && parseFloat(swap.fromToken.balance) > 0 && (
              <div className="flex justify-end gap-2 px-1 -mt-1 mb-1">
                <button
                  onClick={() => swap.setFromAmount((parseFloat(swap.fromToken!.balance!) * 0.25).toString())}
                  className="px-2 py-0.5 text-xs font-semibold text-suwappu-magenta-mid bg-suwappu-sakura-light rounded-full hover:bg-suwappu-sakura-mid transition-colors"
                >
                  25%
                </button>
                <button
                  onClick={() => swap.setFromAmount((parseFloat(swap.fromToken!.balance!) * 0.5).toString())}
                  className="px-2 py-0.5 text-xs font-semibold text-suwappu-magenta-mid bg-suwappu-sakura-light rounded-full hover:bg-suwappu-sakura-mid transition-colors"
                >
                  50%
                </button>
                <button
                  onClick={() => swap.setFromAmount(swap.fromToken!.balance!)}
                  className="px-2 py-0.5 text-xs font-semibold text-suwappu-magenta-mid bg-suwappu-sakura-light rounded-full hover:bg-suwappu-sakura-mid transition-colors"
                >
                  MAX
                </button>
              </div>
            )}

            <SwapArrow onClick={swap.handleSwapTokens} />

            <TokenInput
              label="To"
              amount={swap.quoteFetching ? '...' : swap.toAmount}
              onAmountChange={() => {}}
              token={swap.toTokenDisplay}
              onTokenClick={() => swap.setShowToSelector(true)}
              usdValue={swap.toUsdValue}
              readOnly
            />

            {/* Quote loading indicator */}
            {swap.quoteFetching && (
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 mt-4">
                <QuoteSkeleton />
              </div>
            )}

            {/* Quote error */}
            {swap.quoteError && (
              <div className="bg-suwappu-error/10 rounded-suwappu-lg p-3 text-center">
                <span className="text-xs text-suwappu-error">
                  {(swap.quoteError as { detail?: string })?.detail || 'Failed to get quote'}
                </span>
              </div>
            )}

            {/* Swap error */}
            {swap.swapError && (
              <div className="bg-suwappu-error/10 rounded-suwappu-lg p-3 text-center">
                <span className="text-xs text-suwappu-error">
                  {(swap.swapError as { detail?: string })?.detail || 'Swap failed'}
                </span>
              </div>
            )}

            {swap.quote && !swap.quoteFetching && (
              <div className="mt-4">
                <SwapDetails
                  rate={swap.exchangeRate}
                  priceImpact={swap.priceImpact}
                  networkFee={swap.networkFee}
                  route={swap.quote.route}
                />
              </div>
            )}

            <AnimatedButton
              onClick={swap.handleReview}
              disabled={!swap.canSwap}
              variant="primary"
              size="lg"
              fullWidth
              className="mt-4"
            >
              {swap.buttonText}
            </AnimatedButton>
          </>
        )}
      </div>
    </AppLayout>
  )
}
