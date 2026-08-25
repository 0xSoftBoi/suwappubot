import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { EULER_CHAINS, eulerVaultUrl, fetchEulerVaults, type EulerVault } from '../../lib/euler'
import type { SwapToken } from '../../types/api'
import { usePair } from '../../contexts/PairContext'
import { usdcFor } from '../../lib/quoteTokens'
import { compactUsd, percent } from '../../lib/format'
import { swapDeskSlugForChainId } from '../../lib/swapDeskChains'
import { useIsMobile } from '../../hooks/useIsMobile'
import { requestMobileTab } from '../layout/TradingLayout'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

// Euler's own venue: chain -> EVK lending vaults ranked by TVL, sourced
// from Euler's public Data API V3 (v3.euler.finance) — the same one
// app.euler.finance's own UI queries.
export function EulerPanel() {
  const [chainId, setChainId] = useState(EULER_CHAINS[0].id)
  const [sortBy, setSortBy] = useState<'tvl' | 'supplyApy'>('tvl')
  const [selected, setSelected] = useState<EulerVault | null>(null)
  const { setSelectedPair } = usePair()
  const isMobile = useIsMobile()

  const chain = EULER_CHAINS.find((c) => c.id === chainId) ?? EULER_CHAINS[0]
  const chainSlug = swapDeskSlugForChainId(chainId)
  const tradable = Boolean(chainSlug)

  const {
    data: vaults,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['euler', 'vaults', chainId],
    queryFn: () => fetchEulerVaults(chainId),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })

  const sortedVaults = [...(vaults ?? [])].sort((a, b) =>
    sortBy === 'tvl' ? b.tvlUsd - a.tvlUsd : b.supplyApyPct - a.supplyApyPct,
  )

  function tradeVault(vault: EulerVault) {
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
      <div className="flex h-full flex-col overflow-hidden" data-testid="euler-vault-detail">
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
              href={eulerVaultUrl(selected.chainId, selected.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="terminal-button-secondary px-2.5 py-1 text-xs"
            >
              Open on Euler ↗
            </a>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Supplied</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{compactUsd(selected.tvlUsd)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Supply APY</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{percent(selected.supplyApyPct)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Borrow APY</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{percent(selected.borrowApyPct)}</div>
            </div>
            <div className="rounded border border-terminal-border p-3">
              <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Utilization</div>
              <div className="tnum mt-1 text-sm text-terminal-text">{percent(selected.utilizationPct)}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="euler-panel">
      <div className="shrink-0 border-b border-terminal-border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={chainId}
            onChange={(e) => setChainId(Number(e.target.value))}
            className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
            aria-label="Chain"
          >
            {EULER_CHAINS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
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
            title="Couldn't load Euler vaults"
            description={error instanceof Error ? error.message : "Couldn't reach Euler's API."}
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
        ) : sortedVaults.length === 0 ? (
          <TerminalEmptyState title="No vaults found" description={`No Euler vaults on ${chain.label}.`} />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-left text-terminal-text-muted">
                <th className="px-2 py-1.5 font-medium">Vault</th>
                <th className="px-2 py-1.5 text-right font-medium">Supplied</th>
                <th className="px-2 py-1.5 text-right font-medium">Supply APY</th>
                <th className="px-2 py-1.5 text-right font-medium">Borrow APY</th>
                <th className="px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sortedVaults.map((vault) => (
                <tr
                  key={vault.address}
                  className="group cursor-pointer border-b border-terminal-border/50 text-terminal-text hover:bg-terminal-bg-secondary"
                  onClick={() => setSelected(vault)}
                >
                  <td className="px-2 py-1.5 font-medium">
                    {vault.assetSymbol}
                    <span className="ml-1.5 text-terminal-text-muted">{vault.symbol}</span>
                  </td>
                  <td className="tnum px-2 py-1.5 text-right">{compactUsd(vault.tvlUsd)}</td>
                  <td className="tnum px-2 py-1.5 text-right">{percent(vault.supplyApyPct)}</td>
                  <td className="tnum px-2 py-1.5 text-right">{percent(vault.borrowApyPct)}</td>
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
        <div className="text-[10px] text-terminal-text-muted">Powered by Euler's public Data API V3</div>
      </div>
    </div>
  )
}
