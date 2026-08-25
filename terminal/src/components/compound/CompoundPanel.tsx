import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import toast from 'react-hot-toast'
import { compoundAppUrl, fetchCompoundMarkets, type CompoundMarket } from '../../lib/compound'
import { resolveTokens, type TokenInfo } from '../../lib/v3Amm'
import type { SwapToken } from '../../types/api'
import { usePair } from '../../contexts/PairContext'
import { usdcFor } from '../../lib/quoteTokens'
import { compactUsd, percent } from '../../lib/format'
import { rankChainsByTvl } from '../../lib/chainRanking'
import { swapDeskSlugForChainId } from '../../lib/swapDeskChains'
import { useIsMobile } from '../../hooks/useIsMobile'
import { requestMobileTab } from '../layout/TradingLayout'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

const COMET_ABI = [
  { type: 'function', name: 'baseToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

// Comet's own `baseToken()` view resolves the market's base asset address;
// the summary API doesn't carry it (only USD price + collateral symbols).
// Symbol/decimals for that resolved address reuse the shared `resolveTokens`
// (same multicall primitive the Uniswap/PancakeSwap engine uses) rather than
// a second hand-rolled ERC20 multicall. Falls back to a USD-price-derived
// label when no public client is wired for the chain, so the panel still
// renders on chains the swap desk doesn't cover.
function useBaseAssets(markets: CompoundMarket[], chainId: number) {
  const publicClient = usePublicClient({ chainId })
  return useQuery({
    queryKey: ['compound', 'base-assets', chainId, markets.map((m) => m.cometAddress).join(',')],
    queryFn: async () => {
      const out = new Map<string, TokenInfo>()
      if (!publicClient || markets.length === 0) return out
      const baseTokenResults = await publicClient.multicall({
        contracts: markets.map((m) => ({
          address: m.cometAddress as `0x${string}`,
          abi: COMET_ABI,
          functionName: 'baseToken' as const,
        })),
      })
      const resolved: { market: CompoundMarket; baseTokenAddress: string }[] = []
      baseTokenResults.forEach((r, i) => {
        if (r.status === 'success' && typeof r.result === 'string') {
          resolved.push({ market: markets[i], baseTokenAddress: r.result })
        }
      })
      const tokenInfoByAddress = await resolveTokens(publicClient, resolved.map((r) => r.baseTokenAddress))
      for (const { market, baseTokenAddress } of resolved) {
        const info = tokenInfoByAddress.get(baseTokenAddress.toLowerCase())
        if (info) out.set(market.cometAddress, info)
      }
      return out
    },
    enabled: markets.length > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  })
}

// A USD-price-derived fallback label for chains with no wagmi public client
// wired (so on-chain `baseToken()` resolution isn't possible) — not a guess
// at the exact symbol, just what kind of asset it economically tracks.
function priceBucketLabel(usdPrice: number): string {
  if (usdPrice > 10_000) return `BTC-pegged ($${usdPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })})`
  if (usdPrice > 100) return `ETH-pegged ($${usdPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })})`
  return `USD-pegged ($${usdPrice.toFixed(2)})`
}

// Compound's own venue: chain -> Comet markets ranked by TVL, sourced from
// Compound's public v3 markets API (v3-api.compound.finance) — the same one
// app.compound.finance's own UI queries — with each market's base asset
// resolved by reading the Comet contract's own `baseToken()` on-chain.
export function CompoundPanel() {
  const [chainId, setChainId] = useState<number | null>(null)
  const [selected, setSelected] = useState<CompoundMarket | null>(null)
  const { setSelectedPair } = usePair()
  const isMobile = useIsMobile()

  const {
    data: markets,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['compound', 'markets'],
    queryFn: fetchCompoundMarkets,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })

  const orderedChainIds = useMemo(
    () => rankChainsByTvl(markets ?? [], (m) => m.chainId, (m) => m.totalSupplyUsd),
    [markets],
  )

  const activeChainId = chainId && orderedChainIds.includes(chainId) ? chainId : (orderedChainIds[0] ?? null)
  const chainMarkets = useMemo(
    () => (markets ?? []).filter((m) => m.chainId === activeChainId).sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd),
    [markets, activeChainId],
  )

  const { data: baseAssets } = useBaseAssets(chainMarkets, activeChainId ?? 0)
  const chainSlug = activeChainId ? swapDeskSlugForChainId(activeChainId) : undefined
  const tradable = Boolean(chainSlug)

  function tradeMarket(market: CompoundMarket) {
    const base = baseAssets?.get(market.cometAddress)
    if (!base || !chainSlug) return
    const token: SwapToken = { symbol: base.symbol, name: base.symbol, address: base.address, chain: chainSlug, decimals: base.decimals }
    setSelectedPair({ base: token, quote: usdcFor(chainSlug) })
    if (isMobile) requestMobileTab('swap')
    toast.success(`${base.symbol} loaded into swap`)
  }

  if (selected) {
    const base = baseAssets?.get(selected.cometAddress)
    return (
      <div className="flex h-full flex-col overflow-hidden" data-testid="compound-market-detail">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-border px-2 py-1.5">
          <button onClick={() => setSelected(null)} className="terminal-button-secondary px-2 py-1 text-xs">
            ← Markets
          </button>
          <span className="text-sm font-medium text-terminal-text">
            {base?.symbol ?? priceBucketLabel(selected.baseUsdPrice)}
          </span>
          <span className="rounded-full border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
            {selected.chainName}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {tradable && base && (
              <button onClick={() => tradeMarket(selected)} className="terminal-button px-2.5 py-1 text-xs">
                Trade
              </button>
            )}
            <a href={compoundAppUrl()} target="_blank" rel="noopener noreferrer" className="terminal-button-secondary px-2.5 py-1 text-xs">
              Open on Compound ↗
            </a>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Supplied</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{compactUsd(selected.totalSupplyUsd)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Supply APY</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{percent(selected.supplyAprPct)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Borrow APY</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{percent(selected.borrowAprPct)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Utilization</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{percent(selected.utilizationPct)}</div>
            </div>
          </div>
          {selected.collateralSymbols.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-terminal-text-muted">Accepted collateral</div>
              <div className="flex flex-wrap gap-1">
                {selected.collateralSymbols.map((s) => (
                  <span key={s} className="rounded-full border border-terminal-border bg-terminal-bg-secondary px-1.5 py-0.5 text-[10px] text-terminal-text-secondary">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="compound-panel">
      <div className="shrink-0 border-b border-terminal-border p-2">
        <select
          value={activeChainId ?? ''}
          onChange={(e) => setChainId(Number(e.target.value))}
          className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
          aria-label="Chain"
          disabled={orderedChainIds.length === 0}
        >
          {orderedChainIds.map((id) => (
            <option key={id} value={id}>
              {markets?.find((m) => m.chainId === id)?.chainName ?? id}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isError ? (
          <TerminalEmptyState
            kicker="Load failed"
            title="Couldn't load Compound markets"
            description={error instanceof Error ? error.message : "Couldn't reach Compound's API."}
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
        ) : chainMarkets.length === 0 ? (
          <TerminalEmptyState title="No markets found" description="No Compound markets on this chain." />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-left text-terminal-text-muted">
                <th className="px-2 py-1.5 font-medium">Base asset</th>
                <th className="px-2 py-1.5 text-right font-medium">Supplied</th>
                <th className="px-2 py-1.5 text-right font-medium">Supply APY</th>
                <th className="px-2 py-1.5 text-right font-medium">Borrow APY</th>
                <th className="px-2 py-1.5 text-right font-medium">Utilization</th>
                <th className="px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {chainMarkets.map((m) => {
                const base = baseAssets?.get(m.cometAddress)
                return (
                  <tr
                    key={m.cometAddress}
                    className="group cursor-pointer border-b border-terminal-border/50 text-terminal-text hover:bg-terminal-bg-secondary"
                    onClick={() => setSelected(m)}
                  >
                    <td className="px-2 py-1.5 font-medium">{base?.symbol ?? priceBucketLabel(m.baseUsdPrice)}</td>
                    <td className="tnum px-2 py-1.5 text-right">{compactUsd(m.totalSupplyUsd)}</td>
                    <td className="tnum px-2 py-1.5 text-right">{percent(m.supplyAprPct)}</td>
                    <td className="tnum px-2 py-1.5 text-right">{percent(m.borrowAprPct)}</td>
                    <td className="tnum px-2 py-1.5 text-right">{percent(m.utilizationPct)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {tradable && base && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            tradeMarket(m)
                          }}
                          className="terminal-button-secondary px-2 py-0.5 text-[10px] transition-opacity sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
                        >
                          Trade
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex shrink-0 items-center px-2 py-1.5 border-t border-terminal-border">
        <div className="text-[10px] text-terminal-text-muted">Powered by Compound's public v3 API</div>
      </div>
    </div>
  )
}
