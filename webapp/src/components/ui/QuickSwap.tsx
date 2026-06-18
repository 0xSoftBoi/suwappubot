import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFavoritePairs } from '../../hooks/useFavorites'

// Popular swap pairs (defaults when user has no favorites)
const defaultPairs = [
  { fromToken: 'ETH', fromChain: 'ethereum', toToken: 'USDC', toChain: 'ethereum', name: 'ETH → USDC' },
  { fromToken: 'SOL', fromChain: 'solana', toToken: 'USDC', toChain: 'solana', name: 'SOL → USDC' },
  { fromToken: 'USDC', fromChain: 'ethereum', toToken: 'ETH', toChain: 'ethereum', name: 'USDC → ETH' },
  { fromToken: 'ETH', fromChain: 'ethereum', toToken: 'SOL', toChain: 'solana', name: 'ETH → SOL' },
]

// Token icons
const tokenIcons: Record<string, string> = {
  ETH: 'Ξ',
  SOL: '◎',
  USDC: '$',
  USDT: '$',
  BTC: '₿',
  MATIC: '⬡',
}

interface QuickSwapProps {
  maxItems?: number
  showAddButton?: boolean
}

export function QuickSwap({ maxItems = 4, showAddButton = true }: QuickSwapProps) {
  const navigate = useNavigate()
  const { pairs, incrementUseCount } = useFavoritePairs()
  const [isExpanded, setIsExpanded] = useState(false)

  // Use saved pairs or defaults
  const displayPairs = pairs.length > 0 
    ? pairs.sort((a, b) => b.useCount - a.useCount).slice(0, isExpanded ? 8 : maxItems)
    : defaultPairs.slice(0, maxItems)

  const handleQuickSwap = (pair: typeof displayPairs[0]) => {
    // Track usage if it's a saved pair
    if ('id' in pair && pair.id) {
      incrementUseCount(pair.id)
    }
    
    // Navigate to swap page with pre-filled values
    const params = new URLSearchParams({
      from: pair.fromToken,
      fromChain: pair.fromChain,
      to: pair.toToken,
      toChain: pair.toChain,
    })
    navigate(`/swap?${params}`)
  }

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">
          ⚡ Quick Swap
        </span>
        {pairs.length > maxItems && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-suwappu-magenta-mid"
          >
            {isExpanded ? 'Less' : 'More'}
          </button>
        )}
      </div>

      <div className="p-2 grid grid-cols-2 gap-2">
        {displayPairs.map((pair, i) => {
          const fromIcon = tokenIcons[pair.fromToken] || pair.fromToken[0]
          const toIcon = tokenIcons[pair.toToken] || pair.toToken[0]
          
          return (
            <button
              key={'id' in pair ? pair.id : i}
              onClick={() => handleQuickSwap(pair)}
              className="flex items-center gap-2 p-2 rounded-suwappu-lg bg-suwappu-sakura-light/30 hover:bg-suwappu-sakura-light transition-colors"
            >
              <div className="flex -space-x-1">
                <span className="w-6 h-6 rounded-full bg-suwappu-purple-deep text-white text-xs flex items-center justify-center">
                  {fromIcon}
                </span>
                <span className="w-6 h-6 rounded-full bg-suwappu-magenta-mid text-white text-xs flex items-center justify-center">
                  {toIcon}
                </span>
              </div>
              <div className="flex-1 text-left">
                <p className="text-xs font-medium text-suwappu-text">
                  {pair.name || `${pair.fromToken} → ${pair.toToken}`}
                </p>
                {'useCount' in pair && pair.useCount > 0 && (
                  <p className="text-[9px] text-suwappu-text-secondary">
                    Used {pair.useCount}x
                  </p>
                )}
              </div>
            </button>
          )
        })}

        {showAddButton && (
          <button
            onClick={() => navigate('/swap')}
            className="flex items-center justify-center gap-1 p-2 rounded-suwappu-lg border-2 border-dashed border-suwappu-sakura-mid/30 hover:border-suwappu-magenta-mid/30 transition-colors"
          >
            <span className="text-suwappu-text-secondary text-lg">+</span>
            <span className="text-xs text-suwappu-text-secondary">New Swap</span>
          </button>
        )}
      </div>

      {pairs.length === 0 && (
        <p className="px-3 pb-2 text-[10px] text-suwappu-text-secondary text-center">
          Complete swaps to save your favorites
        </p>
      )}
    </div>
  )
}
