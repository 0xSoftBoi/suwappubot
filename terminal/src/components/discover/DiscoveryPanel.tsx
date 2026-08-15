import { useState, useEffect } from 'react'
import { useNewPools, useTrendingPools } from '../../hooks/useDiscovery'
import type { TokenSecurity, PulseToken } from '../../types/api'
import { NewPairsTable } from './NewPairsTable'
import { TrendingTable } from './TrendingTable'
import { PulseTab } from './PulseTab'
import { TokenDetailView } from './TokenDetailView'
import { usePair } from '../../contexts/PairContext'
import { useTrading } from '../../contexts/TradingContext'
import { pairFromToken } from '../../lib/quoteTokens'
import { TerminalSkeletonRows } from '../foundation'

type Tab = 'pulse' | 'new' | 'trending'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pulse', label: 'Pulse' },
  { id: 'new', label: 'New Pairs' },
  { id: 'trending', label: 'Trending' },
]

const CHAINS = [
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'base', label: 'Base' },
  { id: 'arbitrum', label: 'Arbitrum' },
  { id: 'solana', label: 'Solana' },
  { id: 'bsc', label: 'BSC' },
  { id: 'polygon', label: 'Polygon' },
]

export function DiscoveryPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('pulse')
  const [chain, setChain] = useState('ethereum')
  const [securityMap, setSecurityMap] = useState<Record<string, TokenSecurity>>({})
  const [securityLoading, setSecurityLoading] = useState<Set<string>>(new Set())
  const [selectedToken, setSelectedToken] = useState<PulseToken | null>(null)
  const { setSelectedPair } = usePair()
  const { setPendingSwapAmount } = useTrading()

  // Clicking a token in the feed loads it everywhere: it becomes the active
  // pair (chart + order book + swap panel all follow) and opens its detail view.
  const handleSelectToken = (token: PulseToken) => {
    setSelectedPair(pairFromToken({
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      chain: token.chain,
      decimals: 18,
    }))
    setSelectedToken(token)
  }

  const {
    data: newPools,
    isLoading: newLoading,
    isError: newError,
    dataUpdatedAt: newUpdated,
    refetch: refetchNew,
  } = useNewPools(chain)
  const {
    data: trendingPools,
    isLoading: trendingLoading,
    isError: trendingError,
    dataUpdatedAt: trendingUpdated,
    refetch: refetchTrending,
  } = useTrendingPools(chain)

  // FIX 3: Quick-buy from Pulse/NewPairs — selects the token as the active pair
  // and pre-fills the swap amount so the user lands in SwapPanel ready to confirm.
  const handleQuickBuy = (amount: number, tokenAddress: string) => {
    // Try to resolve the token from newPools (New Pairs tab)
    const pool = newPools?.find(p => p.baseToken.address === tokenAddress)
    if (pool) {
      setSelectedPair(pairFromToken({
        symbol: pool.baseToken.symbol,
        name: pool.name,
        address: pool.baseToken.address,
        chain: chain,
        decimals: 18,
      }))
    }
    // Pre-fill the SwapPanel amount and force buy side via shared context
    setPendingSwapAmount(String(amount))
  }

  const isLoading = activeTab === 'new' ? newLoading : trendingLoading
  const isError = activeTab === 'new' ? newError : trendingError
  const refetchActive = activeTab === 'new' ? refetchNew : refetchTrending
  const lastUpdated = activeTab === 'pulse' ? null : (activeTab === 'new' ? newUpdated : trendingUpdated)

  // Reset security cache when chain changes
  useEffect(() => {
    setSecurityMap({})
    setSecurityLoading(new Set())
  }, [chain])

  const timeSinceUpdate = lastUpdated ? Math.floor((Date.now() - lastUpdated) / 1000) : null

  return (
    <div className="h-full flex flex-col" data-testid="discovery-panel">
      {/* Header with chain filter */}
      <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2 shrink-0">
        <div className="flex items-center gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`terminal-tab ${activeTab === tab.id ? 'terminal-tab-active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab !== 'pulse' && (
          <div className="flex items-center gap-2">
            {/* Auto-refresh indicator */}
            {timeSinceUpdate !== null && (
              <span className="flex items-center gap-1 text-[10px] text-terminal-text-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-slow" />
                {timeSinceUpdate < 5 ? 'Live' : `${timeSinceUpdate}s ago`}
              </span>
            )}

            {/* Chain selector */}
            <select
              value={chain}
              onChange={e => setChain(e.target.value)}
              className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1 text-terminal-text focus:outline-none focus:border-terminal-border-active"
            >
              {CHAINS.map(c => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {selectedToken ? (
          <TokenDetailView token={selectedToken} onBack={() => setSelectedToken(null)} onBuy={handleQuickBuy} />
        ) : activeTab === 'pulse' ? (
          <PulseTab onSelectToken={handleSelectToken} onBuy={handleQuickBuy} />
        ) : isLoading ? (
          <TerminalSkeletonRows
            rows={8}
            columns={6}
            className="p-3"
            label={`Loading ${activeTab === 'new' ? 'new pairs' : 'trending pools'}`}
          />
        ) : isError ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-terminal-text-muted" role="status">
            <span>Couldn't reach the {activeTab === 'new' ? 'new pairs' : 'trending pools'} feed.</span>
            <button
              type="button"
              onClick={() => refetchActive()}
              className="terminal-button-secondary px-3 py-1 text-xs"
            >
              Retry
            </button>
          </div>
        ) : activeTab === 'new' ? (
          <NewPairsTable
            pools={newPools || []}
            securityMap={securityMap}
            securityLoading={securityLoading}
            onBuy={handleQuickBuy}
          />
        ) : (
          <TrendingTable
            pools={trendingPools || []}
            securityMap={securityMap}
            securityLoading={securityLoading}
          />
        )}
      </div>
    </div>
  )
}
