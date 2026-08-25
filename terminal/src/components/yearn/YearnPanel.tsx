import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fetchYearnVaults, yearnVaultUrl, YEARN_CHAINS, type YearnVault } from '../../lib/yearn'
import type { SwapToken } from '../../types/api'
import { usePair } from '../../contexts/PairContext'
import { usdcFor } from '../../lib/quoteTokens'
import { compactUsd, percent } from '../../lib/format'
import { swapDeskSlugForChainId } from '../../lib/swapDeskChains'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useIsMobile } from '../../hooks/useIsMobile'
import { requestMobileTab } from '../layout/TradingLayout'
import { TerminalEmptyState, TerminalSkeletonRows, TerminalTextField } from '../foundation'

// Yearn's own venue: chain -> vaults ranked by TVL/net APY, sourced from
// Yearn's public yDaemon API (ydaemon.yearn.fi) — the same one yearn.fi's
// own UI queries. One fetch covers every chain (yDaemon has no per-chain
// filter that actually works), filtered/sorted client-side per tab.
export function YearnPanel() {
  const [chainId, setChainId] = useState(YEARN_CHAINS[0].id)
  const [sortBy, setSortBy] = useState<'tvl' | 'apy'>('tvl')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<YearnVault | null>(null)
  const debouncedSearch = useDebouncedValue(search)
  const { setSelectedPair } = usePair()
  const isMobile = useIsMobile()

  const chain = YEARN_CHAINS.find((c) => c.id === chainId) ?? YEARN_CHAINS[0]
  const chainSlug = swapDeskSlugForChainId(chainId)
  const tradable = Boolean(chainSlug)

  const {
    data: allVaults,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['yearn', 'vaults'],
    queryFn: fetchYearnVaults,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })

  const vaults = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    return (allVaults ?? [])
      .filter((v) => v.chainId === chainId)
      .filter((v) => !q || v.name.toLowerCase().includes(q) || v.assetSymbol.toLowerCase().includes(q))
      .sort((a, b) => (sortBy === 'tvl' ? b.tvlUsd - a.tvlUsd : (b.netApyPct ?? -Infinity) - (a.netApyPct ?? -Infinity)))
  }, [allVaults, chainId, debouncedSearch, sortBy])

  function tradeVault(vault: YearnVault) {
    if (!chainSlug) return
    const token: SwapToken = {
      symbol: vault.assetSymbol,
      name: vault.assetSymbol,
      address: vault.assetAddress,
      chain: chainSlug,
      decimals: vault.assetDecimals,
    }
    setSelectedPair({ base: token, quote: usdcFor(chainSlug) })
    if (isMobile) requestMobileTab('swap')
    toast.success(`${vault.assetSymbol} loaded into swap`)
  }

  if (selected) {
    return (
      <div className="flex h-full flex-col overflow-hidden" data-testid="yearn-vault-detail">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-border px-2 py-1.5">
          <button onClick={() => setSelected(null)} className="terminal-button-secondary px-2 py-1 text-xs">
            ← Vaults
          </button>
          <span className="text-sm font-medium text-terminal-text">{selected.name}</span>
          <span className="rounded-full border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
            {chain.label} · {selected.assetSymbol}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {tradable && (
              <button onClick={() => tradeVault(selected)} className="terminal-button px-2.5 py-1 text-xs">
                Trade
              </button>
            )}
            <a
              href={yearnVaultUrl(selected.chainId, selected.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="terminal-button-secondary px-2.5 py-1 text-xs"
            >
              Open on Yearn ↗
            </a>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">TVL</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{compactUsd(selected.tvlUsd)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Net APY</div>
              <div className="tnum mt-1 text-sm text-terminal-text">
                {selected.netApyPct === null ? '—' : percent(selected.netApyPct)}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="yearn-panel">
      <div className="shrink-0 border-b border-terminal-border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={chainId}
            onChange={(e) => setChainId(Number(e.target.value))}
            className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
            aria-label="Chain"
          >
            {YEARN_CHAINS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <TerminalTextField
            aria-label="Search Yearn vaults"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vaults, assets…"
            className="w-full sm:w-56"
          />
          <div className="ml-auto flex items-center gap-1">
            {(['tvl', 'apy'] as const).map((col) => (
              <button
                key={col}
                onClick={() => setSortBy(col)}
                className={`terminal-tab text-xs ${sortBy === col ? 'terminal-tab-active' : ''}`}
                aria-pressed={sortBy === col}
              >
                {col === 'tvl' ? 'TVL' : 'Net APY'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isError ? (
          <TerminalEmptyState
            kicker="Load failed"
            title="Couldn't load Yearn vaults"
            description={error instanceof Error ? error.message : "Couldn't reach Yearn's API."}
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
        ) : vaults.length === 0 ? (
          <TerminalEmptyState
            title="No vaults found"
            description={`No Yearn vaults on ${chain.label} match your filters.`}
          />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-left text-terminal-text-muted">
                <th className="px-2 py-1.5 font-medium">Vault</th>
                <th className="px-2 py-1.5 font-medium">Asset</th>
                <th className="px-2 py-1.5 text-right font-medium">TVL</th>
                <th className="px-2 py-1.5 text-right font-medium">Net APY</th>
                <th className="px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {vaults.map((vault) => (
                <tr
                  key={vault.address}
                  className="group cursor-pointer border-b border-terminal-border/50 text-terminal-text hover:bg-terminal-bg-secondary"
                  onClick={() => setSelected(vault)}
                >
                  <td className="px-2 py-1.5 font-medium">{vault.name}</td>
                  <td className="px-2 py-1.5 text-terminal-text-muted">{vault.assetSymbol}</td>
                  <td className="tnum px-2 py-1.5 text-right">{compactUsd(vault.tvlUsd)}</td>
                  <td className="tnum px-2 py-1.5 text-right">
                    {vault.netApyPct === null ? '—' : percent(vault.netApyPct)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {tradable && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          tradeVault(vault)
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
        <div className="text-[10px] text-terminal-text-muted">Powered by Yearn's public yDaemon API</div>
      </div>
    </div>
  )
}
