import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fetchMorphoVaults, morphoVaultUrl, MORPHO_CHAINS, type MorphoVault } from '../../lib/morpho'
import type { SwapToken } from '../../types/api'
import { usePair } from '../../contexts/PairContext'
import { usdcFor } from '../../lib/quoteTokens'
import { compactUsd, percent } from '../../lib/format'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useIsMobile } from '../../hooks/useIsMobile'
import { requestMobileTab } from '../layout/TradingLayout'
import { TerminalEmptyState, TerminalSkeletonRows, TerminalTextField } from '../foundation'

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

// Morpho's own venue: chain -> MetaMorpho vaults ranked by TVL/net APY,
// sourced from Morpho's public GraphQL API (blue-api.morpho.org) — the same
// one app.morpho.org's own UI queries. Shows curated vaults (deposit once,
// the curator allocates across Morpho Blue's isolated markets), not the
// underlying markets themselves.
export function MorphoPanel() {
  const [chainId, setChainId] = useState(MORPHO_CHAINS[0].id)
  const [sortBy, setSortBy] = useState<'TotalAssetsUsd' | 'NetApy'>('TotalAssetsUsd')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<MorphoVault | null>(null)
  const debouncedSearch = useDebouncedValue(search)
  const { setSelectedPair } = usePair()
  const isMobile = useIsMobile()

  const chain = MORPHO_CHAINS.find((c) => c.id === chainId) ?? MORPHO_CHAINS[0]

  const {
    data: vaults,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['morpho', 'vaults', chainId, sortBy, debouncedSearch],
    queryFn: () => fetchMorphoVaults({ chainId, orderBy: sortBy, search: debouncedSearch }),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })

  function tradeVault(vault: MorphoVault) {
    const token: SwapToken = {
      symbol: vault.assetSymbol,
      name: vault.assetSymbol,
      address: vault.assetAddress,
      chain: chain.slug,
      decimals: vault.assetDecimals,
    }
    setSelectedPair({ base: token, quote: usdcFor(chain.slug) })
    if (isMobile) requestMobileTab('swap')
    toast.success(`${vault.assetSymbol} loaded into swap`)
  }

  if (selected) {
    return (
      <div className="flex h-full flex-col overflow-hidden" data-testid="morpho-vault-detail">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-border px-2 py-1.5">
          <button onClick={() => setSelected(null)} className="terminal-button-secondary px-2 py-1 text-xs">
            ← Vaults
          </button>
          <span className="text-sm font-medium text-terminal-text">{selected.name}</span>
          <span className="rounded-full border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
            {chain.label} · {selected.assetSymbol}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => tradeVault(selected)} className="terminal-button px-2.5 py-1 text-xs">
              Trade
            </button>
            <a
              href={morphoVaultUrl(selected.chainId, selected.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="terminal-button-secondary px-2.5 py-1 text-xs"
            >
              Open on Morpho ↗
            </a>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">TVL</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{compactUsd(selected.tvlUsd)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Net APY</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{percent(selected.netApyPct)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Performance fee</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{percent(selected.feePct)}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-terminal-text-muted">
            Curator{' '}
            <span className="text-terminal-text">
              {selected.curator ? truncateAddress(selected.curator) : 'None'}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="morpho-panel">
      <div className="shrink-0 border-b border-terminal-border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={chainId}
            onChange={(e) => setChainId(Number(e.target.value))}
            className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
            aria-label="Chain"
          >
            {MORPHO_CHAINS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <TerminalTextField
            aria-label="Search Morpho vaults"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vaults, assets…"
            className="w-full sm:w-56"
          />
          <div className="ml-auto flex items-center gap-1">
            {([
              ['TotalAssetsUsd', 'TVL'],
              ['NetApy', 'Net APY'],
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
            title="Couldn't load Morpho vaults"
            description={error instanceof Error ? error.message : "Couldn't reach Morpho's API."}
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
        ) : !vaults || vaults.length === 0 ? (
          <TerminalEmptyState
            title="No vaults found"
            description={`No Morpho vaults on ${chain.label} match your filters.`}
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
                  <td className="tnum px-2 py-1.5 text-right">{percent(vault.netApyPct)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        tradeVault(vault)
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
        <div className="text-[10px] text-terminal-text-muted">Powered by Morpho's public GraphQL API</div>
      </div>
    </div>
  )
}
