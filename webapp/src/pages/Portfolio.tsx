import { useMemo } from 'react'
import { AppLayout, AppHeader } from '../components/layout'
import { BalanceCard, TokenItem } from '../components/cards'
import { usePortfolio } from '../hooks/usePortfolio'
import type { Token } from '../types/api'

// Chain icons mapping
const chainIcons: Record<string, string> = {
  ethereum: 'Ξ',
  eth: 'Ξ',
  solana: '◎',
  sol: '◎',
  polygon: '⬡',
  matic: '⬡',
  arbitrum: '🔵',
  optimism: '🔴',
  base: '🔷',
  bsc: '🟡',
}

// Chain colors for allocation chart
const chainColors: Record<string, string> = {
  ethereum: 'bg-blue-500',
  eth: 'bg-blue-500',
  solana: 'bg-purple-500',
  sol: 'bg-purple-500',
  polygon: 'bg-indigo-500',
  matic: 'bg-indigo-500',
  arbitrum: 'bg-sky-500',
  optimism: 'bg-red-500',
  base: 'bg-blue-400',
  bsc: 'bg-yellow-500',
}

// Get icon for token based on symbol or chain
function getTokenIcon(token: Token): string {
  const symbolLower = token.symbol.toLowerCase()
  const chainLower = token.chain.toLowerCase()

  if (symbolLower === 'eth') return 'Ξ'
  if (symbolLower === 'sol') return '◎'
  if (symbolLower === 'usdc' || symbolLower === 'usdt') return '$'
  if (symbolLower === 'matic') return '⬡'

  return chainIcons[chainLower] || token.symbol.charAt(0).toUpperCase()
}

// Format USD value
function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function Portfolio() {
  const { data: portfolio, isLoading, error } = usePortfolio()

  const totalBalance = portfolio ? formatUsd(portfolio.totalUsdValue) : '$0.00'
  const change = 0 // TODO: Calculate from historical data
  const tokens = portfolio?.tokens || []

  // Calculate chain allocations from real data
  const chainAllocations = useMemo(() => {
    if (!portfolio || portfolio.totalUsdValue === 0) return []

    const chainTotals: Record<string, number> = {}
    for (const token of portfolio.tokens) {
      const chain = token.chain.toLowerCase()
      chainTotals[chain] = (chainTotals[chain] || 0) + token.usdValue
    }

    return Object.entries(chainTotals)
      .map(([chain, value]) => ({
        chain: chain.charAt(0).toUpperCase() + chain.slice(1),
        percentage: Math.round((value / portfolio.totalUsdValue) * 100),
        color: chainColors[chain] || 'bg-gray-500',
      }))
      .sort((a, b) => b.percentage - a.percentage)
  }, [portfolio])

  // Loading state
  if (isLoading) {
    return (
      <AppLayout header={<AppHeader title="Portfolio" />} activeNav="portfolio">
        <div className="p-3 pb-20 space-y-4">
          <div className="animate-pulse">
            <div className="bg-suwappu-sakura-light rounded-suwappu-xl h-32 mb-4" />
            <div className="bg-suwappu-sakura-light rounded-suwappu-xl h-24 mb-4" />
            <div className="bg-suwappu-sakura-light rounded-suwappu-xl h-48" />
          </div>
        </div>
      </AppLayout>
    )
  }

  // Error state
  if (error) {
    return (
      <AppLayout header={<AppHeader title="Portfolio" />} activeNav="portfolio">
        <div className="p-3 pb-20">
          <div className="bg-white rounded-suwappu-xl p-6 text-center shadow-suwappu-1">
            <div className="w-12 h-12 mx-auto mb-2 bg-suwappu-error/10 rounded-full flex items-center justify-center">
              <span className="text-xl">⚠️</span>
            </div>
            <p className="text-sm text-suwappu-error mb-1">Failed to load portfolio</p>
            <p className="text-xs text-suwappu-text-secondary">Please try again later</p>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout header={<AppHeader title="Portfolio" />} activeNav="portfolio">
      <div className="p-3 pb-20 space-y-4">
        <BalanceCard balance={totalBalance} change={change} />

        {/* Chain allocation */}
        {chainAllocations.length > 0 && (
          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
            <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-3">Chain Distribution</h3>
            <div className="h-2 rounded-full overflow-hidden flex bg-suwappu-sakura-light">
              {chainAllocations.map((chain) => (
                <div
                  key={chain.chain}
                  className={`${chain.color}`}
                  style={{ width: `${chain.percentage}%` }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-3">
              {chainAllocations.map((chain) => (
                <div key={chain.chain} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${chain.color}`} />
                  <span className="text-xs text-suwappu-text-secondary">
                    {chain.chain} {chain.percentage}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Holdings */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-suwappu-sakura-mid/10">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Holdings</span>
            <select className="text-xs text-suwappu-text-secondary bg-transparent border-none focus:outline-none">
              <option>All Chains</option>
              <option>Ethereum</option>
              <option>Solana</option>
              <option>Polygon</option>
            </select>
          </div>
          {tokens.length > 0 ? (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {tokens.map((token) => (
                <TokenItem
                  key={`${token.chain}-${token.symbol}-${token.address}`}
                  symbol={token.symbol}
                  name={token.name}
                  value={formatUsd(token.usdValue)}
                  balance={token.balance}
                  icon={getTokenIcon(token)}
                />
              ))}
            </div>
          ) : (
            <div className="p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-3 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
                <span className="text-3xl">🌸</span>
              </div>
              <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">No holdings yet</p>
              <p className="text-xs text-suwappu-text-secondary">
                Start by adding funds to your wallet
              </p>
            </div>
          )}
        </div>

        {/* Performance card */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
          <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2">Performance</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
              <p className="text-[10px] text-suwappu-text-secondary">24h</p>
              <p className="text-sm font-heading font-bold text-suwappu-success">+2.1%</p>
            </div>
            <div className="p-2 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
              <p className="text-[10px] text-suwappu-text-secondary">7d</p>
              <p className="text-sm font-heading font-bold text-suwappu-success">+8.4%</p>
            </div>
            <div className="p-2 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
              <p className="text-[10px] text-suwappu-text-secondary">30d</p>
              <p className="text-sm font-heading font-bold text-suwappu-error">-3.2%</p>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
