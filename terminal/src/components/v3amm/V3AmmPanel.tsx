import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import toast from 'react-hot-toast'
import {
  candidatePools,
  discoverPools,
  fetchDexScreenerPairStats,
  resolveTokens,
  type DexScreenerPoolStats,
  type V3AmmConfig,
  type V3ChainConfig,
} from '../../lib/v3Amm'
import type { SwapToken } from '../../types/api'
import { usePair } from '../../contexts/PairContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { requestMobileTab } from '../layout/TradingLayout'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

interface PoolRow {
  address: string
  fee: number
  token0: { address: string; symbol: string; decimals: number }
  token1: { address: string; symbol: string; decimals: number }
  stats: DexScreenerPoolStats | null
}

function compactUsd(value: number): string {
  const sign = value < 0 ? '-' : ''
  const magnitude = Math.abs(value)
  if (magnitude >= 1e12) return `${sign}$${(magnitude / 1e12).toFixed(2)}t`
  if (magnitude >= 1e9) return `${sign}$${(magnitude / 1e9).toFixed(2)}b`
  if (magnitude >= 1e6) return `${sign}$${(magnitude / 1e6).toFixed(2)}m`
  if (magnitude >= 1e3) return `${sign}$${(magnitude / 1e3).toFixed(2)}k`
  return `${sign}$${magnitude.toFixed(2)}`
}

function feeLabel(fee: number): string {
  return `${(fee / 10_000).toFixed(2)}%`
}

// Given the RPC round trips (discover pools → resolve tokens → price each
// pool via DexScreener), this is one combined query per chain rather than a
// waterfall of hook calls in the component.
function usePoolRows(config: V3AmmConfig, chain: V3ChainConfig) {
  const publicClient = usePublicClient({ chainId: chain.chainId })
  return useQuery({
    queryKey: [config.key, 'pools', chain.slug],
    queryFn: async (): Promise<PoolRow[]> => {
      if (!publicClient) return []
      const candidates = candidatePools(config, chain)
      const pools = await discoverPools(publicClient, chain.factory, candidates)
      if (pools.length === 0) return []
      const tokenAddrs = pools.flatMap((p) => [p.token0, p.token1])
      const tokens = await resolveTokens(publicClient, tokenAddrs)
      const stats = await Promise.all(
        pools.map((p) =>
          fetchDexScreenerPairStats(chain.dexScreenerChainId, p.address).catch(() => null),
        ),
      )
      return pools.map((p, i) => ({
        address: p.address,
        fee: p.fee,
        token0: tokens.get(p.token0.toLowerCase()) ?? { address: p.token0, symbol: '?', decimals: 18 },
        token1: tokens.get(p.token1.toLowerCase()) ?? { address: p.token1, symbol: '?', decimals: 18 },
        stats: stats[i],
      }))
    },
    enabled: Boolean(publicClient),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })
}

interface Props {
  config: V3AmmConfig
}

// Generic venue for Uniswap-V3-shaped protocols with no open pools API:
// pool identity comes from the protocol's own Factory contract on-chain
// (`getPool()` for a curated set of major pairs — there's no public way to
// discover every pool without an indexer), and USD TVL/volume for each
// confirmed pool comes from DexScreener, the market-data feed this app
// already uses elsewhere (`dexscreener.ts`).
export function V3AmmPanel({ config }: Props) {
  const [chainSlug, setChainSlug] = useState(config.chains[0].slug)
  const [selected, setSelected] = useState<PoolRow | null>(null)
  const chain = config.chains.find((c) => c.slug === chainSlug) ?? config.chains[0]
  const { setSelectedPair } = usePair()
  const isMobile = useIsMobile()

  const { data: rows, isLoading, isError, error, refetch } = usePoolRows(config, chain)

  const sortedRows = useMemo(
    () => [...(rows ?? [])].sort((a, b) => (b.stats?.tvlUsd ?? 0) - (a.stats?.tvlUsd ?? 0)),
    [rows],
  )

  function tradePool(pool: PoolRow) {
    const toSwapToken = (t: PoolRow['token0']): SwapToken => ({
      symbol: t.symbol,
      name: t.symbol,
      address: t.address,
      chain: chain.slug,
      decimals: t.decimals,
    })
    setSelectedPair({ base: toSwapToken(pool.token0), quote: toSwapToken(pool.token1) })
    if (isMobile) requestMobileTab('swap')
    toast.success(`${pool.token0.symbol}/${pool.token1.symbol} loaded into swap`)
  }

  if (selected) {
    return (
      <div className="flex h-full flex-col overflow-hidden" data-testid={`${config.key}-pool-detail`}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-border px-2 py-1.5">
          <button onClick={() => setSelected(null)} className="terminal-button-secondary px-2 py-1 text-xs">
            ← Pools
          </button>
          <span className="text-sm font-medium text-terminal-text">
            {selected.token0.symbol}/{selected.token1.symbol}
          </span>
          <span className="rounded-full border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
            {chain.label} · {feeLabel(selected.fee)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => tradePool(selected)} className="terminal-button px-2.5 py-1 text-xs">
              Trade
            </button>
            <a
              href={config.poolUrl(chain.slug, selected.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="terminal-button-secondary px-2.5 py-1 text-xs"
            >
              Open on {config.label} ↗
            </a>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">TVL</div>
              <div className="tnum mt-1 text-sm text-terminal-text">
                {selected.stats ? compactUsd(selected.stats.tvlUsd) : '—'}
              </div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">24h Volume</div>
              <div className="tnum mt-1 text-sm text-terminal-text">
                {selected.stats ? compactUsd(selected.stats.volume24hUsd) : '—'}
              </div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Price</div>
              <div className="tnum mt-1 text-sm text-terminal-text">
                {selected.stats ? `$${selected.stats.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : '—'}
              </div>
            </div>
          </div>
          <div className="mt-3 text-[10px] text-terminal-text-muted" title={selected.address}>
            Pool {selected.address}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid={`${config.key}-panel`}>
      <div className="shrink-0 border-b border-terminal-border p-2">
        <select
          value={chainSlug}
          onChange={(e) => setChainSlug(e.target.value)}
          className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
          aria-label="Chain"
        >
          {config.chains.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isError ? (
          <TerminalEmptyState
            kicker="Load failed"
            title={`Couldn't load ${config.label} pools`}
            description={error instanceof Error ? error.message : 'Couldn’t read on-chain pool data.'}
            action={
              <button className="terminal-button px-3 py-1.5 text-xs" onClick={() => refetch()}>
                Retry
              </button>
            }
          />
        ) : isLoading ? (
          <div className="p-3">
            <TerminalSkeletonRows rows={6} />
          </div>
        ) : sortedRows.length === 0 ? (
          <TerminalEmptyState
            title="No pools found"
            description={`None of ${config.label}'s curated pairs have a pool on ${chain.label} yet.`}
          />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-left text-terminal-text-muted">
                <th className="px-2 py-1.5 font-medium">Pool</th>
                <th className="px-2 py-1.5 font-medium">Fee</th>
                <th className="px-2 py-1.5 text-right font-medium">TVL</th>
                <th className="px-2 py-1.5 text-right font-medium">24h Volume</th>
                <th className="px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((pool) => (
                <tr
                  key={`${pool.address}-${pool.fee}`}
                  className="group cursor-pointer border-b border-terminal-border/50 text-terminal-text hover:bg-terminal-bg-secondary"
                  onClick={() => setSelected(pool)}
                >
                  <td className="px-2 py-1.5 font-medium">
                    {pool.token0.symbol}/{pool.token1.symbol}
                  </td>
                  <td className="px-2 py-1.5 text-terminal-text-muted">{feeLabel(pool.fee)}</td>
                  <td className="tnum px-2 py-1.5 text-right">
                    {pool.stats ? compactUsd(pool.stats.tvlUsd) : '—'}
                  </td>
                  <td className="tnum px-2 py-1.5 text-right">
                    {pool.stats ? compactUsd(pool.stats.volume24hUsd) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        tradePool(pool)
                      }}
                      className="terminal-button-secondary px-2 py-0.5 text-[10px] transition-opacity sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
                    >
                      Trade
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex shrink-0 items-center px-2 py-1.5 border-t border-terminal-border">
        <div className="text-[10px] text-terminal-text-muted">
          Pools resolved on-chain via {config.label}'s Factory · market data via DexScreener
        </div>
      </div>
    </div>
  )
}
