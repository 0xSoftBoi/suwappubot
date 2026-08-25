import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { aaveAppUrl, fetchAaveMarkets, marketLabel, type AaveMarket, type AaveReserve } from '../../lib/aave'
import type { SwapToken } from '../../types/api'
import { usePair } from '../../contexts/PairContext'
import { usdcFor } from '../../lib/quoteTokens'
import { compactUsd, percent } from '../../lib/format'
import { rankChainsByTvl } from '../../lib/chainRanking'
import { swapDeskSlugForChainName } from '../../lib/swapDeskChains'
import { useIsMobile } from '../../hooks/useIsMobile'
import { requestMobileTab } from '../layout/TradingLayout'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

// Aave's public markets API lists dozens of deployments; querying every
// chain up front is one request either way, but we cap to the chains the
// swap desk supports plus the largest few others by convention (Aave itself
// concentrates >95% of TVL on these).
const QUERY_CHAIN_IDS = [1, 42161, 10, 137, 8453, 43114, 56]

function ReserveDetail({
  reserve,
  market,
  onBack,
  onTrade,
  tradable,
}: {
  reserve: AaveReserve
  market: AaveMarket
  onBack: () => void
  onTrade: () => void
  tradable: boolean
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="aave-reserve-detail">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-border px-2 py-1.5">
        <button onClick={onBack} className="terminal-button-secondary px-2 py-1 text-xs">
          ← Reserves
        </button>
        <span className="text-sm font-medium text-terminal-text">{reserve.symbol}</span>
        <span className="rounded-full border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
          {market.chainName} · {marketLabel(market)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {tradable && (
            <button onClick={onTrade} className="terminal-button px-2.5 py-1 text-xs">
              Trade
            </button>
          )}
          <a
            href={aaveAppUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="terminal-button-secondary px-2.5 py-1 text-xs"
          >
            Open on Aave ↗
          </a>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded border border-terminal-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Supplied</div>
            <div className="tnum mt-1 text-sm text-terminal-text">{compactUsd(reserve.tvlUsd)}</div>
          </div>
          <div className="rounded border border-terminal-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Supply APY</div>
            <div className="tnum mt-1 text-sm text-terminal-text">{percent(reserve.supplyApy)}</div>
          </div>
          <div className="rounded border border-terminal-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Borrow APY</div>
            <div className="tnum mt-1 text-sm text-terminal-text">
              {reserve.borrowApy === null ? 'Not borrowable' : percent(reserve.borrowApy)}
            </div>
          </div>
          <div className="rounded border border-terminal-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Utilization</div>
            <div className="tnum mt-1 text-sm text-terminal-text">{percent(reserve.utilizationRate)}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-terminal-text-muted">
          <span>
            Available liquidity{' '}
            <span className="tnum text-terminal-text">{compactUsd(reserve.availableLiquidityUsd)}</span>
          </span>
          {reserve.isFrozen && <span className="text-amber-400">Frozen</span>}
          {reserve.isPaused && <span className="text-amber-400">Paused</span>}
        </div>
      </div>
    </div>
  )
}

// Aave's own venue: pick a chain, pick a market (a chain can host more than
// one — Ethereum alone has Main plus isolated EtherFi/Lido/Horizon markets),
// then its reserves ranked by TVL/APY. Sourced straight from Aave's public
// GraphQL API (api.v3.aave.com) — the same one app.aave.com's UI queries.
export function AavePanel() {
  const [chainId, setChainId] = useState<number | null>(null)
  const [marketAddress, setMarketAddress] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'tvl' | 'supplyApy'>('tvl')
  const [selected, setSelected] = useState<AaveReserve | null>(null)
  const { setSelectedPair } = usePair()
  const isMobile = useIsMobile()

  const {
    data: markets,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['aave', 'markets'],
    queryFn: () => fetchAaveMarkets(QUERY_CHAIN_IDS),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })

  // Chains ordered by summed market TVL desc, restricted to chains that
  // actually returned a market this call.
  const orderedChainIds = useMemo(
    () => rankChainsByTvl(markets ?? [], (m) => m.chainId, (m) => m.totalMarketSizeUsd),
    [markets],
  )

  // chainId -> display name, straight off the markets we already fetched —
  // no need for a separate `chains` query just to look up a name.
  const chainNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const m of markets ?? []) if (!map.has(m.chainId)) map.set(m.chainId, m.chainName)
    return map
  }, [markets])

  const activeChainId = chainId && orderedChainIds.includes(chainId) ? chainId : (orderedChainIds[0] ?? null)
  const chainMarkets = useMemo(
    () => (markets ?? []).filter((m) => m.chainId === activeChainId).sort((a, b) => b.totalMarketSizeUsd - a.totalMarketSizeUsd),
    [markets, activeChainId],
  )
  const activeMarket =
    chainMarkets.find((m) => m.address === marketAddress) ?? chainMarkets[0] ?? null

  useEffect(() => {
    setMarketAddress(null)
  }, [activeChainId])

  const reserves = useMemo(() => {
    if (!activeMarket) return []
    return [...activeMarket.reserves].sort((a, b) =>
      sortBy === 'tvl' ? b.tvlUsd - a.tvlUsd : b.supplyApy - a.supplyApy,
    )
  }, [activeMarket, sortBy])

  const chainName = (activeChainId !== null ? chainNameById.get(activeChainId) : undefined) ?? activeMarket?.chainName ?? ''
  const chainSlug = swapDeskSlugForChainName(chainName)
  const tradable = Boolean(chainSlug)

  function tradeReserve(reserve: AaveReserve) {
    if (!chainSlug) return
    const token: SwapToken = {
      symbol: reserve.symbol,
      name: reserve.symbol,
      address: reserve.address,
      chain: chainSlug,
      decimals: reserve.decimals,
    }
    setSelectedPair({ base: token, quote: usdcFor(chainSlug) })
    if (isMobile) requestMobileTab('swap')
    toast.success(`${reserve.symbol} loaded into swap`)
  }

  if (selected && activeMarket) {
    return (
      <ReserveDetail
        reserve={selected}
        market={activeMarket}
        onBack={() => setSelected(null)}
        onTrade={() => tradeReserve(selected)}
        tradable={tradable}
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="aave-panel">
      <div className="shrink-0 border-b border-terminal-border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeChainId ?? ''}
            onChange={(e) => setChainId(Number(e.target.value))}
            className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
            aria-label="Chain"
            disabled={orderedChainIds.length === 0}
          >
            {orderedChainIds.map((id) => (
              <option key={id} value={id}>
                {chainNameById.get(id) ?? id}
              </option>
            ))}
          </select>
          {chainMarkets.length > 1 && (
            <select
              value={activeMarket?.address ?? ''}
              onChange={(e) => setMarketAddress(e.target.value)}
              className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
              aria-label="Market"
            >
              {chainMarkets.map((m) => (
                <option key={m.address} value={m.address}>
                  {marketLabel(m)}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex items-center gap-1">
            {(['tvl', 'supplyApy'] as const).map((col) => (
              <button
                key={col}
                onClick={() => setSortBy(col)}
                className={`terminal-tab text-xs ${sortBy === col ? 'terminal-tab-active' : ''}`}
                aria-pressed={sortBy === col}
              >
                {col === 'tvl' ? 'TVL' : 'Supply APY'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isError ? (
          <TerminalEmptyState
            kicker="Load failed"
            title="Couldn't load Aave markets"
            description={error instanceof Error ? error.message : "Couldn't reach Aave's API."}
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
        ) : reserves.length === 0 ? (
          <TerminalEmptyState title="No reserves found" description="This market has no listed reserves." />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-left text-terminal-text-muted">
                <th className="px-2 py-1.5 font-medium">Asset</th>
                <th className="px-2 py-1.5 text-right font-medium">Supplied</th>
                <th className="px-2 py-1.5 text-right font-medium">Supply APY</th>
                <th className="px-2 py-1.5 text-right font-medium">Borrow APY</th>
                <th className="px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {reserves.map((r) => (
                <tr
                  key={r.address}
                  className="group cursor-pointer border-b border-terminal-border/50 text-terminal-text hover:bg-terminal-bg-secondary"
                  onClick={() => setSelected(r)}
                >
                  <td className="px-2 py-1.5 font-medium">
                    {r.symbol}
                    {r.isFrozen && <span className="ml-1.5 text-terminal-text-muted">frozen</span>}
                  </td>
                  <td className="tnum px-2 py-1.5 text-right">{compactUsd(r.tvlUsd)}</td>
                  <td className="tnum px-2 py-1.5 text-right">{percent(r.supplyApy)}</td>
                  <td className="tnum px-2 py-1.5 text-right">
                    {r.borrowApy === null ? '—' : percent(r.borrowApy)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {tradable && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          tradeReserve(r)
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
        <div className="text-[10px] text-terminal-text-muted">Powered by Aave's public GraphQL API</div>
      </div>
    </div>
  )
}
