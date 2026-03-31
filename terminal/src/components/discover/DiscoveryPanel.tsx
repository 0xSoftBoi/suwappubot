import { useState, useEffect, useCallback } from 'react'
import { useNewPools, useTrendingPools } from '../../hooks/useDiscovery'
import { api } from '../../lib/api'
import type { TokenSecurity, PulseToken } from '../../types/api'
import { NewPairsTable } from './NewPairsTable'
import { TrendingTable } from './TrendingTable'
import { PulseTab } from './PulseTab'
import { TokenDetailView } from './TokenDetailView'

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

  const { data: newPools, isLoading: newLoading, dataUpdatedAt: newUpdated } = useNewPools(chain)
  const { data: trendingPools, isLoading: trendingLoading, dataUpdatedAt: trendingUpdated } = useTrendingPools(chain)

  const pools = activeTab === 'new' ? newPools : trendingPools
  const isLoading = activeTab === 'new' ? newLoading : trendingLoading
  const lastUpdated = activeTab === 'pulse' ? null : (activeTab === 'new' ? newUpdated : trendingUpdated)

  const fetchSecurity = useCallback(async (tokenAddress: string) => {
    if (securityMap[tokenAddress] || securityLoading.has(tokenAddress)) return

    setSecurityLoading(prev => new Set(prev).add(tokenAddress))
    try {
      const security = await api.getTokenSecurity(chain, tokenAddress)
      setSecurityMap(prev => ({ ...prev, [tokenAddress]: security }))
    } catch {
      // Silently fail for security checks
    } finally {
      setSecurityLoading(prev => {
        const next = new Set(prev)
        next.delete(tokenAddress)
        return next
      })
    }
  }, [chain, securityMap, securityLoading])

  // Fetch security for visible pools
  useEffect(() => {
    if (!pools) return
    for (const pool of pools.slice(0, 10)) {
      if (pool.baseToken.address) {
        fetchSecurity(pool.baseToken.address)
      }
    }
  }, [pools, fetchSecurity])

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
          <TokenDetailView token={selectedToken} onBack={() => setSelectedToken(null)} />
        ) : activeTab === 'pulse' ? (
          <PulseTab onSelectToken={setSelectedToken} />
        ) : isLoading ? (
          <div className="flex items-center justify-center h-32 text-terminal-text-muted text-sm animate-pulse">
            Loading {activeTab === 'new' ? 'new pairs' : 'trending pools'}...
          </div>
        ) : activeTab === 'new' ? (
          <NewPairsTable
            pools={newPools || []}
            securityMap={securityMap}
            securityLoading={securityLoading}
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
