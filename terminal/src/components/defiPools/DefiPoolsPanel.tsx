import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  chainsByTvl,
  defiLlamaPoolUrl,
  fetchAllDefiPools,
  poolsForProtocol,
  PROTOCOLS,
  type DefiPool,
  type DefiSortBy,
} from '../../lib/defiPools'
import { useIsMobile } from '../../hooks/useIsMobile'
import { TerminalEmptyState, TerminalSkeletonRows, TerminalTextField } from '../foundation'

const PAGE_SIZE = 50

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

function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [value, delayMs])
  return debounced
}

function PoolDetail({ pool, onBack }: { pool: DefiPool; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="defi-pool-detail">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-border px-2 py-1.5">
        <button onClick={onBack} className="terminal-button-secondary px-2 py-1 text-xs">
          ← Pools
        </button>
        <span className="text-sm font-medium text-terminal-text">{pool.symbol}</span>
        <span className="rounded-full border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
          {pool.chain}
        </span>
        <a
          href={defiLlamaPoolUrl(pool.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="terminal-button-secondary ml-auto px-2.5 py-1 text-xs"
        >
          View on DefiLlama ↗
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <div>
            <div className="text-terminal-text-muted">TVL</div>
            <div className="tnum text-sm text-terminal-text">{compactUsd(pool.tvlUsd)}</div>
          </div>
          <div>
            <div className="text-terminal-text-muted">APY</div>
            <div className="tnum text-sm text-terminal-text">{percent(pool.apy)}</div>
          </div>
          <div>
            <div className="text-terminal-text-muted">Base APY</div>
            <div className="tnum text-sm text-terminal-text">{percent(pool.apyBase)}</div>
          </div>
          <div>
            <div className="text-terminal-text-muted">Reward APY</div>
            <div className="tnum text-sm text-terminal-text">{percent(pool.apyReward)}</div>
          </div>
        </div>
        {pool.poolMeta && (
          <div className="mb-3 text-xs text-terminal-text-secondary">{pool.poolMeta}</div>
        )}
        {pool.underlyingTokens.length > 0 && (
          <div data-testid="defi-detail-tokens">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-terminal-text-muted">
              Underlying tokens
            </div>
            <div className="flex flex-col gap-1">
              {pool.underlyingTokens.map((addr) => (
                <span
                  key={addr}
                  className="truncate rounded border border-terminal-border bg-terminal-bg-secondary px-2 py-1 font-mono text-[11px] text-terminal-text-secondary"
                  title={addr}
                >
                  {addr}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface Props {
  protocolKey: keyof typeof PROTOCOLS
}

// Pools/TVL discovery venue reused across every major protocol — the same
// shape as Curve's native venue (list ranked by TVL, sortable, searchable)
// but sourced from DefiLlama's Yields API instead of a bespoke per-protocol
// integration. Discovery-only: no in-desk swap prefill, since DefiLlama's
// payload has no per-token decimals to prefill a trade safely with.
export function DefiPoolsPanel({ protocolKey }: Props) {
  const config = PROTOCOLS[protocolKey]
  const [chain, setChain] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<DefiSortBy>('tvl')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<DefiPool | null>(null)
  const debouncedSearch = useDebouncedValue(search)
  const isMobile = useIsMobile()

  const { data: allPools, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['defi-pools', 'all'],
    queryFn: fetchAllDefiPools,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  const protocolPools = useMemo(
    () => (allPools ? poolsForProtocol(allPools, config.slug) : []),
    [allPools, config.slug],
  )

  const orderedChains = useMemo(() => chainsByTvl(protocolPools), [protocolPools])
  const activeChain = chain && orderedChains.includes(chain) ? chain : (orderedChains[0] ?? null)

  useEffect(() => {
    setPage(1)
  }, [activeChain, sortBy, debouncedSearch])

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    return protocolPools
      .filter((p) => p.chain === activeChain)
      .filter((p) => !q || p.symbol.toLowerCase().includes(q))
      .sort((a, b) => (sortBy === 'tvl' ? b.tvlUsd - a.tvlUsd : b.apy - a.apy))
  }, [protocolPools, activeChain, debouncedSearch, sortBy])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (selected) {
    return <PoolDetail pool={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid={`${protocolKey}-pools-panel`}>
      <div className="shrink-0 border-b border-terminal-border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeChain ?? ''}
            onChange={(e) => setChain(e.target.value)}
            className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
            aria-label="Chain"
            disabled={orderedChains.length === 0}
          >
            {orderedChains.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <TerminalTextField
            aria-label={`Search ${config.label} pools`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol…"
            className="w-full sm:w-56"
          />
          <div className="ml-auto flex items-center gap-1">
            {(['tvl', 'apy'] as DefiSortBy[]).map((col) => (
              <button
                key={col}
                onClick={() => setSortBy(col)}
                className={`terminal-tab text-xs ${sortBy === col ? 'terminal-tab-active' : ''}`}
                aria-pressed={sortBy === col}
              >
                {col === 'tvl' ? 'TVL' : 'APY'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isError ? (
          <TerminalEmptyState
            kicker="Load failed"
            title={`Couldn't load ${config.label} pools`}
            description={error instanceof Error ? error.message : "Couldn't reach the DefiLlama Yields API."}
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
        ) : pageItems.length === 0 ? (
          <TerminalEmptyState
            title="No pools found"
            description={
              debouncedSearch
                ? `No ${config.label} pools on ${activeChain ?? 'this chain'} match "${debouncedSearch}".`
                : `No ${config.label} pools tracked on ${activeChain ?? 'this chain'}.`
            }
          />
        ) : isMobile ? (
          <ul className="divide-y divide-terminal-border/50">
            {pageItems.map((pool) => (
              <li key={pool.id} className="px-3 py-2.5" onClick={() => setSelected(pool)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-medium text-terminal-text">
                    {pool.symbol}
                  </div>
                  <a
                    href={defiLlamaPoolUrl(pool.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 p-1 text-terminal-accent"
                  >
                    ↗
                  </a>
                </div>
                <div className="mt-2 flex gap-4 text-[11px]">
                  <div>
                    <div className="text-terminal-text-muted">TVL</div>
                    <div className="tnum text-terminal-text">{compactUsd(pool.tvlUsd)}</div>
                  </div>
                  <div>
                    <div className="text-terminal-text-muted">APY</div>
                    <div className="tnum text-terminal-text">{percent(pool.apy)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-left text-terminal-text-muted">
                <th className="px-2 py-1.5 font-medium">Pool</th>
                <th className="px-2 py-1.5 text-right font-medium">TVL</th>
                <th className="px-2 py-1.5 text-right font-medium">APY</th>
                <th className="px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((pool) => (
                <tr
                  key={pool.id}
                  className="cursor-pointer border-b border-terminal-border/50 text-terminal-text hover:bg-terminal-bg-secondary"
                  onClick={() => setSelected(pool)}
                >
                  <td className="px-2 py-1.5 font-medium">
                    {pool.symbol}
                    {pool.poolMeta ? (
                      <span className="ml-1.5 text-terminal-text-muted">{pool.poolMeta}</span>
                    ) : null}
                  </td>
                  <td className="tnum px-2 py-1.5 text-right">{compactUsd(pool.tvlUsd)}</td>
                  <td className="tnum px-2 py-1.5 text-right">{percent(pool.apy)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <a
                      href={defiLlamaPoolUrl(pool.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-terminal-accent hover:underline"
                    >
                      ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-terminal-border px-2 py-1.5">
        <div className="text-[10px] text-terminal-text-muted">
          {config.icon} {config.externalName} pools · Powered by DefiLlama Yields API
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-terminal-text-muted">
            Page {page} of {totalPages} · {filtered.length} pools
          </span>
          <button
            className="terminal-button-secondary px-2 py-1 text-xs disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Prev
          </button>
          <button
            className="terminal-button-secondary px-2 py-1 text-xs disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
