import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  BALANCER_CHAINS,
  balancerPoolUrl,
  fetchBalancerPools,
  type BalancerPool,
  type BalancerSortBy,
} from '../../lib/balancer'
import type { SwapToken } from '../../types/api'
import { usePair } from '../../contexts/PairContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { requestMobileTab } from '../layout/TradingLayout'
import { TerminalEmptyState, TerminalSkeletonRows, TerminalTextField } from '../foundation'

function compactUsd(value: number): string {
  const sign = value < 0 ? '-' : ''
  const magnitude = Math.abs(value)
  if (magnitude >= 1e12) return `${sign}$${(magnitude / 1e12).toFixed(2)}t`
  if (magnitude >= 1e9) return `${sign}$${(magnitude / 1e9).toFixed(2)}b`
  if (magnitude >= 1e6) return `${sign}$${(magnitude / 1e6).toFixed(2)}m`
  if (magnitude >= 1e3) return `${sign}$${(magnitude / 1e3).toFixed(2)}k`
  return `${sign}$${magnitude.toFixed(2)}`
}

function percent(value: number): string {
  return `${value.toFixed(2)}%`
}

function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [value, delayMs])
  return debounced
}

// Balancer's own venue: chain -> pools ranked by TVL/volume/APR, sourced
// straight from Balancer's public v3 GraphQL API (api-v3.balancer.fi) — the
// same one app.balancer.fi's own UI queries.
export function BalancerPanel() {
  const [chainId, setChainId] = useState(BALANCER_CHAINS[0].id)
  const [sortBy, setSortBy] = useState<BalancerSortBy>('totalLiquidity')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<BalancerPool | null>(null)
  const debouncedSearch = useDebouncedValue(search)
  const { setSelectedPair } = usePair()
  const isMobile = useIsMobile()

  const chain = BALANCER_CHAINS.find((c) => c.id === chainId) ?? BALANCER_CHAINS[0]

  const {
    data: pools,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['balancer', 'pools', chainId, sortBy, debouncedSearch],
    queryFn: () =>
      fetchBalancerPools({ chainId, orderBy: sortBy, orderDirection: 'desc', textSearch: debouncedSearch }),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })

  function tradePool(pool: BalancerPool) {
    const [a, b] = pool.tokens
    if (!a || !b) return
    const toSwapToken = (t: BalancerPool['tokens'][number]): SwapToken => ({
      symbol: t.symbol,
      name: t.symbol,
      address: t.address,
      chain: chain.slug,
      decimals: t.decimals,
    })
    setSelectedPair({ base: toSwapToken(a), quote: toSwapToken(b) })
    if (isMobile) requestMobileTab('swap')
    toast.success(`${a.symbol}/${b.symbol} loaded into swap`)
  }

  if (selected) {
    return (
      <div className="flex h-full flex-col overflow-hidden" data-testid="balancer-pool-detail">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-border px-2 py-1.5">
          <button onClick={() => setSelected(null)} className="terminal-button-secondary px-2 py-1 text-xs">
            ← Pools
          </button>
          <span className="text-sm font-medium text-terminal-text">{selected.name}</span>
          <span className="rounded-full border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
            {chain.label} · {selected.poolType}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {selected.tokens.length >= 2 && (
              <button onClick={() => tradePool(selected)} className="terminal-button px-2.5 py-1 text-xs">
                Trade
              </button>
            )}
            <a
              href={balancerPoolUrl(chain.slug, selected)}
              target="_blank"
              rel="noopener noreferrer"
              className="terminal-button-secondary px-2.5 py-1 text-xs"
            >
              Open on Balancer ↗
            </a>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">TVL</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{compactUsd(selected.tvlUsd)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">24h Volume</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{compactUsd(selected.volume24hUsd)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">24h Fees</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{compactUsd(selected.fees24hUsd)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">APR</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{percent(selected.aprPct)}</div>
            </div>
          </div>
          {selected.tokens.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {selected.tokens.map((t) => (
                <span
                  key={t.address}
                  className="rounded-full border border-terminal-border bg-terminal-bg-secondary px-1.5 py-0.5 text-[10px] text-terminal-text-secondary"
                  title={t.address}
                >
                  {t.symbol}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="balancer-panel">
      <div className="shrink-0 border-b border-terminal-border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
            className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
            aria-label="Chain"
          >
            {BALANCER_CHAINS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <TerminalTextField
            aria-label="Search Balancer pools"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pools, tokens…"
            className="w-full sm:w-56"
          />
          <div className="ml-auto flex items-center gap-1">
            {([
              ['totalLiquidity', 'TVL'],
              ['volume24h', '24h Volume'],
              ['apr', 'APR'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setSortBy(id)}
                className={`terminal-tab text-xs ${sortBy === id ? 'terminal-tab-active' : ''}`}
                aria-pressed={sortBy === id}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isError ? (
          <TerminalEmptyState
            kicker="Load failed"
            title="Couldn't load Balancer pools"
            description={error instanceof Error ? error.message : "Couldn't reach Balancer's API."}
            action={
              <button className="terminal-button px-3 py-1.5 text-xs" onClick={() => refetch()}>
                Retry
              </button>
            }
          />
        ) : isLoading ? (
          <div className="p-3">
            <TerminalSkeletonRows rows={8} />
          </div>
        ) : !pools || pools.length === 0 ? (
          <TerminalEmptyState
            title="No pools found"
            description={`No Balancer pools on ${chain.label} match your filters.`}
          />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-left text-terminal-text-muted">
                <th className="px-2 py-1.5 font-medium">Pool</th>
                <th className="px-2 py-1.5 text-right font-medium">TVL</th>
                <th className="px-2 py-1.5 text-right font-medium">24h Volume</th>
                <th className="px-2 py-1.5 text-right font-medium">APR</th>
                <th className="px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {pools.map((pool) => (
                <tr
                  key={pool.id}
                  className="group cursor-pointer border-b border-terminal-border/50 text-terminal-text hover:bg-terminal-bg-secondary"
                  onClick={() => setSelected(pool)}
                >
                  <td className="px-2 py-1.5 font-medium">
                    <div className="flex flex-wrap items-center gap-1">
                      {pool.tokens.length === 0
                        ? pool.name
                        : pool.tokens.map((t, i) => (
                            <span
                              key={`${t.address}-${i}`}
                              className="rounded-full border border-terminal-border bg-terminal-bg-secondary px-1.5 py-0.5 text-[10px] leading-none text-terminal-text-secondary"
                              title={t.address}
                            >
                              {t.symbol}
                            </span>
                          ))}
                    </div>
                  </td>
                  <td className="tnum px-2 py-1.5 text-right">{compactUsd(pool.tvlUsd)}</td>
                  <td className="tnum px-2 py-1.5 text-right">{compactUsd(pool.volume24hUsd)}</td>
                  <td className="tnum px-2 py-1.5 text-right">{percent(pool.aprPct)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {pool.tokens.length >= 2 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          tradePool(pool)
                        }}
                        className="terminal-button-secondary px-2 py-0.5 text-[10px] transition-opacity sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
                      >
                        Trade
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex shrink-0 items-center px-2 py-1.5 border-t border-terminal-border">
        <div className="text-[10px] text-terminal-text-muted">Powered by Balancer's public v3 API</div>
      </div>
    </div>
  )
}
