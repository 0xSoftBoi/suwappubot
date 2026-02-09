import { useNavigate } from 'react-router-dom'
import { AppLayout, UserHeader } from '../components/layout'
import { BalanceCard, TokenItem } from '../components/cards'
import { TokenInput, SwapArrow, SwapDetails, TokenSelector } from '../components/swap'
import { ChainSelector, defaultChains, SkeletonCard, QuoteSkeleton, Confetti, TransactionProgress, AnimatedButton, AnimatedListItem } from '../components/ui'
import type { TransactionStatus } from '../components/ui'
import { usePortfolio } from '../hooks/usePortfolio'
import { useSwapForm, getExplorerUrl } from '../hooks/useSwapForm'
import { getTokenIcon } from '../lib/icons'

// Format USD value
function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function Home() {
  const navigate = useNavigate()
  const { data: portfolio, isLoading, error, refetch } = usePortfolio()
  const swap = useSwapForm()

  const balance = portfolio ? formatUsd(portfolio.totalUsdValue) : '$0.00'
  const tokens = portfolio?.tokens || []

  const header = (
    <UserHeader
      showSettings={true}
      onSettingsClick={() => navigate('/settings')}
    />
  )

  // Map swap status to transaction progress status
  const txStatus: TransactionStatus = swap.swapPending
    ? 'submitting'
    : swap.swapStatus?.status === 'submitted'
    ? 'pending'
    : swap.swapStatus?.status === 'failed'
    ? 'failed'
    : 'confirming'

  const chainName = defaultChains.find(c => c.id === swap.selectedChain)?.name.toLowerCase() || 'ethereum'

  return (
    <AppLayout header={header} activeNav="home">
      <div className="p-3 space-y-4 pb-20">
        <BalanceCard balance={balance} />

        {/* Swap area — switches between form, progress, and success */}
        {swap.isSuccess ? (
          <>
            <Confetti active={swap.isSuccess} duration={4000} pieces={60} />
            <div className="bg-white rounded-suwappu-xxl p-6 shadow-suwappu-2 text-center" role="alert" aria-live="assertive">
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
          </>
        ) : (swap.swapPending || swap.activeSwapId != null) ? (
          <div className="space-y-4" role="status" aria-live="polite">
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
        ) : (
          /* Swap form */
          <div className="space-y-1">
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

                {swap.quoteFetching && (
                  <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 mt-4">
                    <QuoteSkeleton />
                  </div>
                )}

                {swap.quoteError && (
                  <div className="bg-suwappu-error/10 rounded-suwappu-lg p-3 text-center">
                    <span className="text-xs text-suwappu-error">
                      {(swap.quoteError as { detail?: string })?.detail || 'Failed to get quote'}
                    </span>
                  </div>
                )}

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
        )}

        {/* Assets list */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Assets</span>
            <button className="text-xs text-suwappu-magenta-mid font-medium">See All</button>
          </div>
          {isLoading ? (
            <SkeletonCard rows={3} variant="token" />
          ) : error || tokens.length === 0 ? (
            <div className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-3 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
                <span className="text-3xl">🌸</span>
              </div>
              <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">No assets yet</p>
              <p className="text-xs text-suwappu-text-secondary mb-3">
                {error ? 'Tap to refresh' : 'Add funds to start trading'}
              </p>
              <button
                onClick={() => error ? refetch() : navigate('/wallet')}
                className="px-4 py-2 bg-suwappu-gradient text-white text-sm font-heading font-bold rounded-suwappu-pill shadow-suwappu-button"
              >
                {error ? 'Refresh' : 'Add Funds'}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {tokens.map((token, index) => (
                <AnimatedListItem key={`${token.chain}-${token.symbol}-${token.address}`} index={index}>
                  <TokenItem
                    symbol={token.symbol}
                    name={token.name}
                    value={formatUsd(token.usdValue)}
                    balance={token.balance}
                    icon={getTokenIcon(token)}
                  />
                </AnimatedListItem>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Token selector bottom-sheet overlays */}
      {swap.showFromSelector && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-end" onClick={() => swap.setShowFromSelector(false)}>
          <div className="bg-white rounded-t-2xl w-full max-h-[80vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-heading font-bold text-suwappu-purple-deep">Select Token</h3>
              <button
                onClick={() => swap.setShowFromSelector(false)}
                className="text-suwappu-text-secondary text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
            <TokenSelector
              selectedToken={swap.fromToken}
              onSelect={swap.handleFromTokenSelect}
              chain={swap.selectedChain}
              excludeAddresses={swap.toToken ? [swap.toToken.address] : []}
            />
          </div>
        </div>
      )}

      {swap.showToSelector && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-end" onClick={() => swap.setShowToSelector(false)}>
          <div className="bg-white rounded-t-2xl w-full max-h-[80vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-heading font-bold text-suwappu-purple-deep">Select Token</h3>
              <button
                onClick={() => swap.setShowToSelector(false)}
                className="text-suwappu-text-secondary text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
            <TokenSelector
              selectedToken={swap.toToken}
              onSelect={swap.handleToTokenSelect}
              chain={swap.selectedChain}
              excludeAddresses={swap.fromToken ? [swap.fromToken.address] : []}
            />
          </div>
        </div>
      )}

      {/* Confirmation bottom-sheet overlay */}
      {swap.isConfirming && swap.quote && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-end" onClick={() => swap.setIsConfirming(false)}>
          <div className="bg-white rounded-t-2xl w-full p-4 pb-8" onClick={e => e.stopPropagation()}>
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

            <div className="bg-suwappu-sakura-light/50 rounded-suwappu-xl p-3 mb-4">
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
        </div>
      )}
    </AppLayout>
  )
}
