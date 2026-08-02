import { useEffect, useState } from 'react'
import { usePair } from '../../contexts/PairContext'
import { useTokenIntel } from '../../hooks/useTokenIntel'
import { BubbleMap } from './BubbleMap'
import { DeployerCard } from './DeployerCard'
import { FlagStrip } from './FlagStrip'
import { HolderTable } from './HolderTable'
import { DevWatchList } from './DevWatchList'
import {
  TerminalButton,
  TerminalDivider,
  TerminalEmptyState,
  TerminalMetricCard,
  TerminalSegmentedTabs,
  TerminalSkeletonRows,
  TerminalSkeletonText,
} from '../foundation'
import { formatPct } from '../../lib/intelFormat'

const CHAINS = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'base', label: 'Base' },
  { id: 'arbitrum', label: 'Arbitrum' },
  { id: 'optimism', label: 'Optimism' },
  { id: 'solana', label: 'Solana' },
  { id: 'bsc', label: 'BSC' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'avalanche', label: 'Avalanche' },
  { id: 'sui', label: 'Sui' },
]

type SubTab = 'intel' | 'devwatch'

export function IntelPanel() {
  const { selectedPair } = usePair()
  const [subTab, setSubTab] = useState<SubTab>('intel')
  const [chainInput, setChainInput] = useState('auto')
  const [addressInput, setAddressInput] = useState('')
  const [query, setQuery] = useState<{ chain: string; address: string } | null>(null)
  const [prefilled, setPrefilled] = useState(false)

  // Prefill from the terminal's currently-selected token/pair, once, so the
  // panel isn't empty if the user already has a token open elsewhere.
  useEffect(() => {
    if (prefilled) return
    const base = selectedPair.base
    if (base?.address) {
      setAddressInput(base.address)
      setChainInput(base.chain || 'auto')
      setQuery({ chain: base.chain || 'auto', address: base.address })
      setPrefilled(true)
    }
  }, [selectedPair, prefilled])

  const { data: intel, isLoading, isFetching, error, failureReason, refetch } = useTokenIntel(
    query?.chain ?? '',
    query?.address ?? ''
  )

  const handleSearch = () => {
    const trimmed = addressInput.trim()
    if (!trimmed) return
    setQuery({ chain: chainInput, address: trimmed })
  }

  const handleSelectFromWatch = (chain: string, tokenAddress: string) => {
    setChainInput(chain)
    setAddressInput(tokenAddress)
    setQuery({ chain, address: tokenAddress })
    setSubTab('intel')
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="intel-panel">
      <div className="shrink-0 border-b border-terminal-border p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <TerminalSegmentedTabs
            activeId={subTab}
            onChange={(id) => setSubTab(id as SubTab)}
            options={[
              { id: 'intel', label: 'Token Intel' },
              { id: 'devwatch', label: 'Dev Watch' },
            ]}
          />
        </div>

        {subTab === 'intel' && (
          <div className="flex items-center gap-1.5">
            <select
              value={chainInput}
              onChange={(e) => setChainInput(e.target.value)}
              className="text-xs bg-terminal-bg-secondary border border-terminal-border rounded px-2 py-1.5 text-terminal-text focus:outline-none focus:border-terminal-border-active"
              aria-label="Chain"
            >
              {CHAINS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch()
              }}
              placeholder="Token contract address"
              className="tnum min-w-0 flex-1 bg-terminal-bg-secondary border border-terminal-border rounded px-2.5 py-1.5 text-[12px] text-terminal-text placeholder-terminal-text-muted outline-none focus:border-terminal-border-active font-mono"
            />
            <TerminalButton size="sm" onClick={handleSearch} disabled={!addressInput.trim()}>
              Scan
            </TerminalButton>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {subTab === 'devwatch' && <DevWatchList onSelectToken={handleSelectFromWatch} />}

        {subTab === 'intel' && (
          <IntelResults
            hasQuery={query !== null}
            intel={intel ?? null}
            isLoading={isLoading}
            isFetching={isFetching}
            error={error}
            failureReason={failureReason}
            onRetry={() => refetch()}
          />
        )}
      </div>
    </div>
  )
}

function IntelResults({
  hasQuery,
  intel,
  isLoading,
  isFetching,
  error,
  failureReason,
  onRetry,
}: {
  hasQuery: boolean
  intel: import('../../types/api').TokenIntel | null
  isLoading: boolean
  isFetching: boolean
  error: unknown
  failureReason: unknown
  onRetry: () => void
}) {
  if (!hasQuery) {
    return (
      <TerminalEmptyState
        kicker="Token Intel"
        title="Scan a token"
        description="Paste a contract address (or leave chain on Auto-detect) to pull deployer history, holder distribution, wallet clusters, and bundle/snipe signals."
      />
    )
  }

  // A 429 mid-retry: react-query is backing off (bounded, respecting
  // Retry-After) before it lands in `error`. Surface that honestly instead of
  // a plain spinner so it doesn't read as a hang.
  const inFlightStatus = (failureReason as { status?: number } | undefined)?.status
  if (isLoading && inFlightStatus === 429) {
    return (
      <TerminalEmptyState
        kicker="Rate limited"
        title="Slow down a moment"
        description="Too many scans in a short window — retrying shortly on its own. No need to resubmit."
      />
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <TerminalSkeletonText lines={2} />
        <TerminalSkeletonRows rows={4} columns={3} />
      </div>
    )
  }

  // Never blank the panel on error — show what happened + a retry.
  if (error) {
    const status = (error as { status?: number } | undefined)?.status
    const isRateLimited = status === 429
    const message =
      typeof error === 'object' && error && 'detail' in error
        ? String((error as { detail?: string }).detail)
        : 'Could not load token intel.'
    return (
      <TerminalEmptyState
        kicker={isRateLimited ? 'Rate limited' : 'Scan failed'}
        title={isRateLimited ? 'Still rate limited — try again shortly' : "Couldn't load this token"}
        description={isRateLimited ? 'This endpoint is per-IP rate limited. Wait a few seconds, then retry.' : message}
        action={
          <TerminalButton size="sm" onClick={onRetry}>
            Retry
          </TerminalButton>
        }
      />
    )
  }

  if (!intel) {
    return (
      <TerminalEmptyState title="No data" description="This token returned no intel data." />
    )
  }

  return (
    <div className="flex flex-col gap-4" data-testid="intel-results">
      {isFetching && (
        <div className="text-[9px] uppercase text-terminal-text-muted">Refreshing…</div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold text-terminal-text">
            {intel.symbol ?? '--'}{' '}
            <span className="text-[11px] font-normal text-terminal-text-secondary">{intel.name ?? ''}</span>
          </div>
          <div className="font-mono text-[10px] text-terminal-text-muted">{intel.chain}</div>
        </div>
      </div>

      <FlagStrip flags={intel.flags} />

      <div className="grid grid-cols-3 gap-2">
        <TerminalMetricCard label="Top 10" value={formatPct(intel.top10_pct, 1)} />
        <TerminalMetricCard label="Bundle Buyers" value={String(intel.bundle_buyer_count ?? '--')} />
        <TerminalMetricCard label="Snipe Buyers" value={String(intel.snipe_buyer_count ?? '--')} />
      </div>

      <TerminalDivider />

      <div>
        <div className="mb-2 text-[10px] uppercase text-terminal-text-muted">Bubble Map</div>
        <BubbleMap holders={intel.top_holders} clusterGroups={intel.cluster_groups} />
      </div>

      <TerminalDivider />

      <div>
        <div className="mb-2 text-[10px] uppercase text-terminal-text-muted">Deployer</div>
        <DeployerCard
          deployer={intel.deployer}
          chain={intel.chain}
          priorDeploys={intel.deployer_prior_deploys}
          deadDeploys={intel.deployer_dead_deploys}
        />
      </div>

      <TerminalDivider />

      <div>
        <div className="mb-2 text-[10px] uppercase text-terminal-text-muted">Top Holders</div>
        <HolderTable holders={intel.top_holders} top10Pct={intel.top10_pct} />
      </div>

      {intel.notes.length > 0 && (
        <div className="rounded-[var(--terminal-radius-card)] border border-terminal-border bg-terminal-bg-secondary/50 px-2.5 py-2 text-[10px] leading-4 text-terminal-text-muted" data-testid="intel-notes">
          <span className="font-semibold text-terminal-text-secondary">Partial data: </span>
          {intel.notes.join(' · ')}
        </div>
      )}
    </div>
  )
}
