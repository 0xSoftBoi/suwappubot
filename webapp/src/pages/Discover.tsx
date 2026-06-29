import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { MiniChart } from '../components/charts/MiniChart'
import { SkeletonCard, AnimatedListItem } from '../components/ui'
import { useTrendingTokens } from '../hooks/useChart'
import type { LineData, Time } from 'lightweight-charts'

const CHAIN_FILTERS = [
  { id: undefined, label: 'All' },
  { id: 'ethereum', label: 'ETH' },
  { id: 'solana', label: 'SOL' },
  { id: 'base', label: 'Base' },
  { id: 'arbitrum', label: 'ARB' },
  { id: 'tempo', label: 'Tempo' },
  { id: 'bsc', label: 'BSC' },
  { id: 'sui', label: 'SUI' },
  { id: 'monad', label: 'MON' },
  { id: 'berachain', label: 'BERA' },
]

// Format price with appropriate decimals
function formatPrice(price: number): string {
  if (price < 0.0001) return `$${price.toExponential(2)}`
  if (price < 1) return `$${price.toFixed(6)}`
  if (price < 100) return `$${price.toFixed(4)}`
  return `$${price.toFixed(2)}`
}

// Generate sparkline data from a token's price history
function generateSparkline(token: { sparkline?: Array<{ time: number; value: number }>; price?: number; priceChange24h?: number }): LineData<Time>[] {
  if (token.sparkline && token.sparkline.length > 0) {
    return token.sparkline.map((p) => ({
      time: p.time as Time,
      value: p.value,
    }))
  }
  // Fallback: generate simple two-point line from price change
  const now = Math.floor(Date.now() / 1000)
  const dayAgo = now - 86400
  const currentPrice = token.price || 1
  const change = token.priceChange24h || 0
  const prevPrice = currentPrice / (1 + change / 100)
  return [
    { time: dayAgo as Time, value: prevPrice },
    { time: now as Time, value: currentPrice },
  ]
}

export default function Discover() {
  const navigate = useNavigate()
  const [chainFilter, setChainFilter] = useState<string | undefined>(undefined)
  const { data: trendingData, isLoading } = useTrendingTokens(chainFilter)

  const tokens = trendingData || []

  const header = <AppHeader title="Discover" />

  return (
    <AppLayout header={header} activeNav="discover">
      <div className="p-3 space-y-3 pb-20">
        {/* Chain filter tabs */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {CHAIN_FILTERS.map(chain => (
            <button
              key={chain.label}
              onClick={() => setChainFilter(chain.id)}
              className={`px-3 py-1.5 text-xs font-heading font-semibold rounded-suwappu-pill whitespace-nowrap transition-colors ${
                chainFilter === chain.id
                  ? 'bg-suwappu-gradient text-white shadow-suwappu-button'
                  : 'bg-white text-suwappu-text-secondary border border-suwappu-sakura-mid/20 hover:border-suwappu-magenta-mid'
              }`}
            >
              {chain.label}
            </button>
          ))}
        </div>

        {/* Trending tokens */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Trending Tokens</span>
          </div>

          {isLoading ? (
            <SkeletonCard rows={5} variant="token" />
          ) : tokens.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-suwappu-text-secondary">No trending tokens found</p>
            </div>
          ) : (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {tokens.map((token, index) => (
                <AnimatedListItem key={`${token.chainId}-${token.tokenAddress}`} index={index}>
                  <button
                    onClick={() => navigate(`/token/${token.chainId}/${token.tokenAddress}`)}
                    className="w-full flex items-center gap-3 px-3 py-3 hover:bg-suwappu-sakura-light/30 transition-colors text-left"
                  >
                    {/* Token icon */}
                    <div className="w-10 h-10 rounded-full bg-suwappu-sakura-light flex items-center justify-center text-sm font-bold text-suwappu-magenta-mid flex-shrink-0 overflow-hidden">
                      {token.icon ? (
                        <img src={token.icon} alt={token.symbol || ''} className="w-full h-full object-cover" />
                      ) : (
                        (token.symbol || '??').slice(0, 2)
                      )}
                    </div>

                    {/* Token info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-semibold text-sm text-suwappu-text truncate">{token.name || 'Unknown'}</p>
                      <p className="text-xs text-suwappu-text-secondary">{token.symbol || ''}</p>
                    </div>

                    {/* Mini chart */}
                    <div className="flex-shrink-0">
                      <MiniChart data={generateSparkline(token)} />
                    </div>

                    {/* Price info */}
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="font-heading font-semibold text-sm text-suwappu-text">
                        {formatPrice(token.price || 0)}
                      </p>
                      <p className={`text-xs font-semibold ${
                        (token.priceChange24h || 0) >= 0 ? 'text-green-500' : 'text-red-500'
                      }`}>
                        {(token.priceChange24h || 0) >= 0 ? '+' : ''}{(token.priceChange24h || 0).toFixed(2)}%
                      </p>
                    </div>
                  </button>
                </AnimatedListItem>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
