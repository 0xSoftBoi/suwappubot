import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fetchLidoApr, fetchLidoStats, lidoStakeUrl, STETH_ADDRESS, STETH_DECIMALS } from '../../lib/lido'
import type { SwapToken } from '../../types/api'
import { usePair } from '../../contexts/PairContext'
import { useAuth } from '../../contexts/AuthContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { requestMobileTab } from '../layout/TradingLayout'
import { TerminalEmptyState, TerminalSkeletonRows } from '../foundation'

// WETH on Ethereum mainnet — the quote leg for a stETH pair. A fixed constant
// rather than a lookup: both tokens' decimals are protocol-level facts (ERC-20
// 18dp), not something to trust an unreliable third-party field for.
const WETH: SwapToken = {
  symbol: 'WETH',
  name: 'Wrapped Ether',
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  chain: 'ethereum',
  decimals: 18,
}

const STETH: SwapToken = {
  symbol: 'stETH',
  name: 'Lido Staked Ether',
  address: STETH_ADDRESS,
  chain: 'ethereum',
  decimals: STETH_DECIMALS,
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

// Lido's own protocol venue: single-product stats (it's one liquid-staking
// pool, not a pool list like Curve's), sourced straight from Lido's public
// `eth-api.lido.fi` API — the same one stake.lido.fi's own UI calls.
export function LidoPanel() {
  const { setSelectedPair } = usePair()
  const { isAuthenticated, signInWithWallet, signInWithGoogle } = useAuth()
  const isMobile = useIsMobile()

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['lido', 'stats'],
    queryFn: fetchLidoStats,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })

  const { data: apr, isLoading: aprLoading } = useQuery({
    queryKey: ['lido', 'apr'],
    queryFn: fetchLidoApr,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  function tradeStEth() {
    setSelectedPair({ base: STETH, quote: WETH })
    if (isMobile) requestMobileTab('swap')
    toast.success('stETH/WETH loaded into swap')
  }

  const loading = statsLoading || aprLoading

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="lido-panel">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {statsError ? (
          <TerminalEmptyState
            kicker="Load failed"
            title="Couldn't reach Lido's API"
            description="stake.lido.fi's own stats endpoint didn't respond."
            action={
              <button className="terminal-button px-3 py-1.5 text-xs" onClick={() => refetchStats()}>
                Retry
              </button>
            }
          />
        ) : loading ? (
          <TerminalSkeletonRows rows={4} />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold text-terminal-text">stETH</span>
              <span className="rounded-full border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-text-muted">
                ethereum
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={tradeStEth}
                  className="terminal-button px-2.5 py-1 text-xs"
                  data-testid="lido-trade-button"
                >
                  Trade
                </button>
                <a
                  href={lidoStakeUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="terminal-button-secondary px-2.5 py-1 text-xs"
                >
                  Stake ↗
                </a>
              </div>
            </div>

            <div className={`grid gap-3 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
              <div className="rounded border border-terminal-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">TVL</div>
                <div className="tnum mt-1 text-lg text-terminal-text">
                  {stats ? compactUsd(stats.marketCapUsd) : '—'}
                </div>
              </div>
              <div className="rounded border border-terminal-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">
                  Total staked
                </div>
                <div className="tnum mt-1 text-lg text-terminal-text">
                  {stats ? `${stats.totalStakedEth.toLocaleString(undefined, { maximumFractionDigits: 0 })} ETH` : '—'}
                </div>
              </div>
              <div className="rounded border border-terminal-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">
                  7d SMA APR
                </div>
                <div className="tnum mt-1 text-lg text-terminal-text">
                  {apr ? `${apr.smaApr.toFixed(2)}%` : '—'}
                </div>
              </div>
              <div className="rounded border border-terminal-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-terminal-text-muted">
                  Holders
                </div>
                <div className="tnum mt-1 text-lg text-terminal-text">
                  {stats ? stats.uniqueHolders.toLocaleString() : '—'}
                </div>
              </div>
            </div>

            {apr && apr.points.length > 0 && (
              <div className="mt-4" data-testid="lido-apr-series">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-terminal-text-muted">
                  Daily APR (recent)
                </div>
                <div className="flex items-end gap-1" style={{ height: 48 }}>
                  {(() => {
                    const max = Math.max(...apr.points.map((p) => p.apr), 0.01)
                    return apr.points.map((p) => (
                      <div
                        key={p.timeUnix}
                        className="min-w-[6px] flex-1 rounded-t bg-terminal-accent/70"
                        style={{ height: `${Math.max(4, (p.apr / max) * 48)}px` }}
                        title={`${p.apr.toFixed(2)}%`}
                      />
                    ))
                  })()}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {!isAuthenticated && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-t border-terminal-border bg-terminal-bg-secondary/50 px-2 py-1.5"
          data-testid="lido-connect-cta"
        >
          <span className="text-xs text-terminal-text-secondary">Sign in to trade stETH from the swap desk:</span>
          <button onClick={() => void signInWithWallet()} className="terminal-button px-2.5 py-1 text-xs">
            Connect wallet
          </button>
          <button onClick={() => signInWithGoogle()} className="terminal-button-secondary px-2.5 py-1 text-xs">
            Continue with Google
          </button>
        </div>
      )}
      <div className="flex shrink-0 items-center px-2 py-1.5 border-t border-terminal-border">
        <div className="text-[10px] text-terminal-text-muted">Powered by Lido's public API</div>
      </div>
    </div>
  )
}
