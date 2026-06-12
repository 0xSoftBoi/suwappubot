import { useSwapHistory } from '../hooks/useSwapHistory'
import { SwapCard } from './SwapCard'
import { useTelegram } from '../hooks/useTelegram'

export function SwapHistory() {
  const { data: swaps, isLoading, error, refetch } = useSwapHistory()
  const { hapticFeedback } = useTelegram()

  const handleRefresh = async () => {
    hapticFeedback('light')
    await refetch()
  }

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-tg-secondary rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-500 mb-4">Failed to load swap history</p>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-tg-button text-tg-button-text rounded-lg"
        >
          Retry
        </button>
      </div>
    )
  }

  const swapList = swaps || []

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-tg-text">Recent Swaps</h2>
        <button
          onClick={handleRefresh}
          className="text-tg-link text-sm"
        >
          Refresh
        </button>
      </div>

      {swapList.length === 0 ? (
        <div className="text-center py-8 text-tg-hint">
          <p>No swaps yet</p>
          <p className="text-sm mt-1">Your swap history will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {swapList.map((swap) => (
            <SwapCard key={swap.id} swap={swap} />
          ))}
        </div>
      )}
    </div>
  )
}
