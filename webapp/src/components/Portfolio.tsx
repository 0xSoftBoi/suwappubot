import { usePortfolio } from '../hooks/usePortfolio'
import { TokenBalance } from './TokenBalance'
import { useTelegram } from '../hooks/useTelegram'

export function Portfolio() {
  const { data: portfolio, isLoading, error, refetch } = usePortfolio()
  const { hapticFeedback } = useTelegram()

  const handleRefresh = async () => {
    hapticFeedback('light')
    await refetch()
  }

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-tg-secondary rounded-xl" />
          <div className="h-16 bg-tg-secondary rounded-xl" />
          <div className="h-16 bg-tg-secondary rounded-xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-500 mb-4">Failed to load portfolio</p>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-tg-button text-tg-button-text rounded-lg"
        >
          Retry
        </button>
      </div>
    )
  }

  const totalValue = portfolio?.totalUsdValue || 0
  const tokens = portfolio?.tokens || []

  return (
    <div className="p-4 space-y-4">
      {/* Total Value Card */}
      <div className="bg-tg-secondary rounded-xl p-4">
        <p className="text-tg-hint text-sm">Total Balance</p>
        <p className="text-3xl font-bold text-tg-text mt-1">
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>

      {/* Tokens List */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-tg-text">Assets</h2>
          <button
            onClick={handleRefresh}
            className="text-tg-link text-sm"
          >
            Refresh
          </button>
        </div>

        {tokens.length === 0 ? (
          <div className="text-center py-8 text-tg-hint">
            <p>No assets found</p>
            <p className="text-sm mt-1">Start by making a swap!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tokens.map((token) => (
              <TokenBalance key={`${token.chain}-${token.address}`} token={token} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
