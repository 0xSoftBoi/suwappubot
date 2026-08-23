import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  fetchChainTvls,
  fetchCurveChains,
  fetchCurvePools,
  MAX_PAGE_SIZE,
  type CurvePool,
  type CurveSortBy,
  type CurveSortDirection,
} from '../../lib/curve'
import type { SwapToken } from '../../types/api'
import { usePair } from '../../contexts/PairContext'
import { useAuth } from '../../contexts/AuthContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { requestMobileTab } from '../layout/TradingLayout'
import { TerminalEmptyState, TerminalSkeletonRows, TerminalTextField } from '../foundation'

// Chains where the terminal's swap desk can actually quote and execute —
// the intersection of ChainSelector's list and Curve's chain names (which
// happen to agree on these ids). Pools on other Curve chains still list;
// they just link out to curve.finance instead of offering in-desk Trade.
const TRADABLE_CHAINS = new Set([
  'ethereum',
  'arbitrum',
  'base',
  'optimism',
  'polygon',
  'bsc',
  'avalanche',
])

// Server-side sort keys the v2 `/pools/` endpoint accepts, confirmed from
// `flet-curve/src/curve/sort.py` (`SortOption.field`): "tvl", "volume",
// "aggregate_apr" (incentives — not surfaced here), "base_daily_apr".
const SORT_COLUMNS: { id: CurveSortBy; label: string }[] = [
  { id: 'tvl', label: 'TVL' },
  { id: 'volume', label: '24h Volume' },
  { id: 'base_daily_apr', label: 'Base APR' },
]

function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [value, delayMs])
  return debounced
}

function compactUsd(value: number): string {
  const sign = value < 0 ? '-' : ''
  const magnitude = Math.abs(value)
  if (magnitude >= 1e12) return `${sign}$${(magnitude / 1e12).toFixed(2)}t`
  if (magnitude >= 1e9) return `${sign}$${(magnitude / 1e9).toFixed(2)}b`
  if (magnitude >= 1e6) return `${sign}$${(magnitude / 1e6).toFixed(2)}m`
  if (magnitude >= 1e3) return `${sign}$${(magnitude / 1e3).toFixed(2)}k`
  if (magnitude === 0) return '$0'
  return `${sign}$${magnitude.toFixed(2)}`
}

function percent(value: number): string {
  return `${value.toFixed(2)}%`
}

function coinToSwapToken(coin: CurvePool['coins'][number], chain: string): SwapToken {
  return {
    symbol: coin.symbol,
    name: coin.symbol,
    address: coin.address,
    chain,
    decimals: coin.decimals,
  }
}

export function CurvePoolsPanel() {
  const [chainName, setChainName] = useState<string>('ethereum')
  const [sortBy, setSortBy] = useState<CurveSortBy>('volume')
  const [sortDirection, setSortDirection] = useState<CurveSortDirection>('desc')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const debouncedSearch = useDebouncedValue(search)
  const { setSelectedPair } = usePair()
  const { isAuthenticated, signInWithWallet, signInWithGoogle } = useAuth()
  const isMobile = useIsMobile()

  // Load a pool's first two coins into the swap desk as base/quote — the same
  // pre-fill gesture DiscoveryPanel's quick-buy uses. Only offered on chains
  // the desk can execute on (see TRADABLE_CHAINS).
  function tradePool(pool: CurvePool, chain: string) {
    const [base, quote] = pool.coins
    if (!base || !quote) return
    setSelectedPair({
      base: coinToSwapToken(base, chain),
      quote: coinToSwapToken(quote, chain),
    })
    if (isMobile) requestMobileTab('swap')
    toast.success(`${base.symbol}/${quote.symbol} loaded into swap`)
  }

  const { data: chains, isLoading: chainsLoading } = useQuery({
    queryKey: ['curve', 'chains'],
    queryFn: fetchCurveChains,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  const { data: chainTvls } = useQuery({
    queryKey: ['curve', 'chain-tvls'],
    queryFn: fetchChainTvls,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  // Chains ordered by v1 pool TVL desc — the same ordering flet-curve's own
  // chain picker uses so the busiest chains lead.
  const orderedChains = useMemo(() => {
    if (!chains) return []
    const tvlByName = new Map((chainTvls ?? []).map((c) => [c.name, c.poolTvl]))
    return [...chains].sort((a, b) => (tvlByName.get(b.name) ?? 0) - (tvlByName.get(a.name) ?? 0))
  }, [chains, chainTvls])

  const activeChain = orderedChains.find((c) => c.name === chainName) ?? orderedChains[0]

  // Reset to page 1 whenever the query params change.
  useEffect(() => {
    setPage(1)
  }, [chainName, sortBy, sortDirection, debouncedSearch])

  const {
    data: poolsPage,
    isLoading: poolsLoading,
    isFetching: poolsFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['curve', 'pools', activeChain?.chainId, page, sortBy, sortDirection, debouncedSearch],
    queryFn: () =>
      fetchCurvePools({
        chainId: activeChain!.chainId,
        chainName: activeChain!.name,
        page,
        pageSize: MAX_PAGE_SIZE,
        sortBy,
        sortDirection,
        searchString: debouncedSearch,
      }),
    enabled: Boolean(activeChain),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  })

  const pools = poolsPage?.pools ?? []
  const count = poolsPage?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(count / MAX_PAGE_SIZE))

  function toggleSort(column: CurveSortBy) {
    if (sortBy === column) {
      setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(column)
      setSortDirection('desc')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="curve-pools-panel">
      <div className="shrink-0 border-b border-terminal-border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeChain?.name ?? ''}
            onChange={(e) => setChainName(e.target.value)}
            className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
            aria-label="Chain"
            data-testid="curve-chain-select"
            disabled={chainsLoading || orderedChains.length === 0}
          >
            {orderedChains.map((c) => (
              <option key={c.chainId} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          <TerminalTextField
            aria-label="Search Curve pools"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pools, coins, address…"
            className="w-56"
            data-testid="curve-search-input"
          />

          <div className="ml-auto flex items-center gap-1">
            {SORT_COLUMNS.map((col) => {
              const active = sortBy === col.id
              return (
                <button
                  key={col.id}
                  onClick={() => toggleSort(col.id)}
                  className={`terminal-tab text-xs ${active ? 'terminal-tab-active' : ''}`}
                  aria-pressed={active}
                >
                  {col.label} {active ? (sortDirection === 'desc' ? '▼' : '▲') : ''}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isError ? (
          <TerminalEmptyState
            kicker="Load failed"
            title="Couldn't load Curve pools"
            description={error instanceof Error ? error.message : "Couldn't reach the Curve Prices API."}
            action={
              <button className="terminal-button px-3 py-1.5 text-xs" onClick={() => refetch()}>
                Retry
              </button>
            }
          />
        ) : poolsLoading && pools.length === 0 ? (
          <div className="p-3">
            <TerminalSkeletonRows rows={8} />
          </div>
        ) : pools.length === 0 ? (
          <TerminalEmptyState
            title="No pools found"
            description={
              debouncedSearch
                ? `No Curve pools on ${activeChain?.name ?? 'this chain'} match "${debouncedSearch}".`
                : `No Curve pools with sufficient TVL found on ${activeChain?.name ?? 'this chain'}.`
            }
          />
        ) : (
          <table className="w-full border-collapse text-xs" data-testid="curve-pools-table">
            <thead>
              <tr className="border-b border-terminal-border text-left text-terminal-text-muted">
                <th className="px-2 py-1.5 font-medium">Pool</th>
                <th className="px-2 py-1.5 font-medium">Coins</th>
                <th className="px-2 py-1.5 text-right font-medium">TVL</th>
                <th className="px-2 py-1.5 text-right font-medium">24h Volume</th>
                <th className="px-2 py-1.5 text-right font-medium">Base APR</th>
                <th className="px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {pools.map((pool) => {
                const chain = activeChain?.name ?? ''
                const tradable = TRADABLE_CHAINS.has(chain) && pool.coins.length >= 2
                return (
                  <tr key={pool.address} className="group border-b border-terminal-border/50 text-terminal-text hover:bg-terminal-bg-secondary">
                    <td className="px-2 py-1.5 font-medium">{pool.name}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {pool.coins.length === 0
                          ? '—'
                          : pool.coins.map((c, i) => (
                              <span
                                key={`${c.address}-${i}`}
                                className="rounded-full border border-terminal-border bg-terminal-bg-secondary px-1.5 py-0.5 text-[10px] leading-none text-terminal-text-secondary"
                                title={c.address}
                              >
                                {c.symbol}
                              </span>
                            ))}
                      </div>
                    </td>
                    <td className="tnum px-2 py-1.5 text-right">{compactUsd(pool.tvlUsd)}</td>
                    <td className="tnum px-2 py-1.5 text-right">{compactUsd(pool.volume24h)}</td>
                    <td className="tnum px-2 py-1.5 text-right">{percent(pool.baseApr)}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {tradable && (
                        <button
                          onClick={() => tradePool(pool, chain)}
                          className="terminal-button-secondary mr-2 px-2 py-0.5 text-[10px] transition-opacity sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
                          aria-label={`Trade ${pool.name} in the swap panel`}
                          data-testid="curve-trade-button"
                        >
                          Trade
                        </button>
                      )}
                      {pool.poolUrl ? (
                        <a
                          href={pool.poolUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-terminal-accent hover:underline"
                          aria-label={`Open ${pool.name} on curve.finance`}
                        >
                          ↗
                        </a>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {!isAuthenticated && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-t border-terminal-border bg-terminal-bg-secondary/50 px-2 py-1.5"
          data-testid="curve-connect-cta"
        >
          <span className="text-xs text-terminal-text-secondary">
            Sign in to trade Curve pools from the swap desk:
          </span>
          <button
            onClick={() => void signInWithWallet()}
            className="terminal-button px-2.5 py-1 text-xs"
            data-testid="curve-connect-wallet"
          >
            Connect wallet
          </button>
          <button
            onClick={() => signInWithGoogle()}
            className="terminal-button-secondary px-2.5 py-1 text-xs"
            data-testid="curve-connect-google"
          >
            Continue with Google
          </button>
        </div>
      )}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-terminal-border px-2 py-1.5">
        <div className="text-[10px] text-terminal-text-muted">
          Powered by Curve Prices API · fork: flet-curve
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-terminal-text-muted">
            Page {page} of {totalPages} · {count} pools
          </span>
          <button
            className="terminal-button-secondary px-2 py-1 text-xs disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || poolsFetching}
          >
            Prev
          </button>
          <button
            className="terminal-button-secondary px-2 py-1 text-xs disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || poolsFetching}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
