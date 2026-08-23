import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { formatUnits, parseUnits, type Hex } from 'viem'
import { fetchCurvePools, MAX_PAGE_SIZE, type CurvePool } from '../../lib/curve'
import { QuoterClient } from '../../lib/erouter/quoter'
import { buildCandidates, universeCoins, type RouteCandidate } from '../../lib/erouter/routes'
import { TerminalEmptyState, TerminalTextField } from '../foundation'

// Chains wagmi's config carries a public client for, keyed by Curve's chain
// names — the intersection the router can eth_call on from the browser.
const ROUTER_CHAINS: Record<string, number> = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  base: 8453,
  bsc: 56,
  avalanche: 43114,
}

interface RankedRoute {
  candidate: RouteCandidate
  amountOut: bigint
}

interface Props {
  chainName: string
  chainId: number
}

// The electric-router route finder: enumerate candidates over the Curve pool
// universe (lib/erouter/routes.ts), then price every candidate EXACTLY in one
// eth_call to the deployed RouteQuoter — the same contract the flet app's
// router verifies against. The circuit solver replaces enumeration with
// calibrated flow-splitting in the next phase; the quoting path is this one
// either way.
export function CurveRouterTab({ chainName, chainId }: Props) {
  const wagmiChainId = ROUTER_CHAINS[chainName]
  const publicClient = usePublicClient({ chainId: wagmiChainId })

  const [sellAddr, setSellAddr] = useState('')
  const [buyAddr, setBuyAddr] = useState('')
  const [amount, setAmount] = useState('1')

  // Universe: the chain's 100 heaviest pools by TVL (two pages at the API's
  // 50-row cap) — same floor the pool list uses, so no dust pools.
  const { data: pools, isLoading: poolsLoading } = useQuery({
    queryKey: ['curve', 'router-universe', chainId],
    queryFn: async () => {
      const pages = await Promise.all(
        [1, 2].map((page) =>
          fetchCurvePools({ chainId, chainName, page, pageSize: MAX_PAGE_SIZE, sortBy: 'tvl' }),
        ),
      )
      return pages.flatMap((p) => p.pools)
    },
    staleTime: 5 * 60_000,
  })

  const coins = useMemo(() => (pools ? universeCoins(pools).slice(0, 80) : []), [pools])
  const sellCoin = coins.find((c) => c.address === sellAddr)
  const buyCoin = coins.find((c) => c.address === buyAddr)

  const [routes, setRoutes] = useState<RankedRoute[] | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function findRoutes() {
    if (!pools || !sellCoin || !buyCoin || !publicClient) return
    setQuoting(true)
    setError(null)
    setRoutes(null)
    try {
      const amountIn = parseUnits(amount || '0', sellCoin.decimals)
      if (amountIn <= 0n) throw new Error('Enter an amount above zero.')
      const candidates = buildCandidates(pools, sellCoin.address, buyCoin.address)
      if (candidates.length === 0) {
        setRoutes([])
        return
      }
      const client = new QuoterClient(async (to, data) => {
        const res = await publicClient.call({ to, data })
        if (!res.data) throw new Error('empty eth_call result')
        return res.data as Hex
      })
      const outs = await client.quoteRoutes(
        candidates.map((c) => c.legs),
        candidates.map(() => amountIn),
        candidates.map((c) => c.dstSlot),
      )
      const ranked = candidates
        .map((candidate, idx) => ({ candidate, amountOut: outs[idx] ?? 0n }))
        .filter((r) => r.amountOut > 0n)
        .sort((a, b) => (b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0))
      setRoutes(ranked)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quoting failed.')
    } finally {
      setQuoting(false)
    }
  }

  if (!wagmiChainId) {
    return (
      <TerminalEmptyState
        title="Router not available on this chain"
        description={`No browser RPC is configured for ${chainName}. Pick Ethereum, Arbitrum, Base, Optimism, Polygon, BSC, or Avalanche.`}
      />
    )
  }

  const best = routes && routes.length > 0 ? routes[0] : null

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="curve-router-tab">
      <div className="shrink-0 border-b border-terminal-border p-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-terminal-text-muted">
            Sell
            <select
              value={sellAddr}
              onChange={(e) => setSellAddr(e.target.value)}
              className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
              data-testid="router-sell-select"
              disabled={poolsLoading}
            >
              <option value="">token…</option>
              {coins.map((c) => (
                <option key={c.address} value={c.address}>
                  {c.symbol}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-terminal-text-muted">
            Buy
            <select
              value={buyAddr}
              onChange={(e) => setBuyAddr(e.target.value)}
              className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
              data-testid="router-buy-select"
              disabled={poolsLoading}
            >
              <option value="">token…</option>
              {coins
                .filter((c) => c.address !== sellAddr)
                .map((c) => (
                  <option key={c.address} value={c.address}>
                    {c.symbol}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-terminal-text-muted">
            Amount
            <TerminalTextField
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="w-28"
              aria-label="Amount to sell"
              data-testid="router-amount-input"
            />
          </label>
          <button
            onClick={() => void findRoutes()}
            disabled={quoting || poolsLoading || !sellCoin || !buyCoin}
            className="terminal-button px-3 py-1.5 text-xs disabled:opacity-40"
            data-testid="router-find-button"
          >
            {quoting ? 'Quoting…' : 'Find routes'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error ? (
          <TerminalEmptyState kicker="Quote failed" title="Couldn't quote routes" description={error} />
        ) : routes === null ? (
          <TerminalEmptyState
            title="Pick two tokens"
            description={
              poolsLoading
                ? 'Loading the pool universe…'
                : `Candidates are built over the chain's ${pools?.length ?? 0} heaviest Curve pools, then every route is priced exactly in one eth_call to the RouteQuoter contract.`
            }
          />
        ) : routes.length === 0 ? (
          <TerminalEmptyState
            title="No route found"
            description="No direct or two-hop path connects these tokens in the loaded universe."
          />
        ) : (
          <div className="flex flex-col gap-1" data-testid="router-results">
            {routes.map((r, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                  idx === 0
                    ? 'border-terminal-accent/60 bg-terminal-bg-secondary'
                    : 'border-terminal-border/50'
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-terminal-text">
                  {r.candidate.path.join(' → ')}
                  <span className="text-terminal-text-muted"> · {r.candidate.poolNames.join(' + ')}</span>
                </span>
                <span className="tnum shrink-0 text-terminal-text">
                  {Number(formatUnits(r.amountOut, buyCoin?.decimals ?? 18)).toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}{' '}
                  {buyCoin?.symbol}
                </span>
                {idx === 0 && (
                  <span className="shrink-0 rounded-full border border-terminal-accent/60 px-1.5 py-0.5 text-[10px] text-terminal-accent">
                    best
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-terminal-border px-2 py-1.5 text-[10px] text-terminal-text-muted">
        {best
          ? `${routes!.length} route${routes!.length === 1 ? '' : 's'} priced on-chain in one eth_call · `
          : ''}
        Quotes via electric-router's RouteQuoter (0x9a32…e679, same address on every chain)
      </div>
    </div>
  )
}
