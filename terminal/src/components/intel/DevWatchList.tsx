import toast from 'react-hot-toast'
import { truncateAddress } from '../../lib/intelFormat'
import { useDevWatchHits, useDevWatchList, useRemoveDevWatch } from '../../hooks/useTokenIntel'
import { TerminalEmptyState, TerminalIconButton, TerminalSkeletonRows } from '../foundation'

interface DevWatchListProps {
  onSelectToken: (chain: string, tokenAddress: string) => void
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function DevWatchList({ onSelectToken }: DevWatchListProps) {
  const { data: watchList, isLoading: watchLoading } = useDevWatchList()
  const { data: hits, isLoading: hitsLoading } = useDevWatchHits(50)
  const removeWatch = useRemoveDevWatch()

  const handleRemove = (id: number) => {
    removeWatch.mutate(id, {
      onError: () => toast.error("Couldn't remove that deployer — try again."),
    })
  }

  if (watchLoading) {
    return <TerminalSkeletonRows rows={4} columns={3} />
  }

  const list = watchList ?? []

  return (
    <div className="flex flex-col gap-4" data-testid="devwatch-list">
      <div>
        <div className="mb-1.5 text-[10px] uppercase text-terminal-text-muted">Watched Deployers</div>
        {list.length === 0 ? (
          <TerminalEmptyState
            title="No deployers watched yet"
            description="Use “Watch deployer” on a token's intel view to get alerted when it ships again."
          />
        ) : (
          <div className="flex flex-col divide-y divide-terminal-border">
            {list.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] text-terminal-text">
                    {entry.label || truncateAddress(entry.deployer_address)}
                  </div>
                  <div className="text-[9px] text-terminal-text-muted">
                    {entry.chain} · {entry.hits_count} {entry.hits_count === 1 ? 'launch' : 'launches'} tracked
                  </div>
                </div>
                <TerminalIconButton
                  label="Stop watching this deployer"
                  onClick={() => handleRemove(entry.id)}
                  disabled={removeWatch.isPending}
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
                  </svg>
                </TerminalIconButton>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 text-[10px] uppercase text-terminal-text-muted">Recent Hits</div>
        {hitsLoading ? (
          <TerminalSkeletonRows rows={3} columns={2} />
        ) : !hits || hits.length === 0 ? (
          <div className="text-[10px] text-terminal-text-muted">
            No new launches from watched deployers yet.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {hits.map((hit, i) => (
              <button
                key={`${hit.token_address}-${hit.detected_at}-${i}`}
                onClick={() => onSelectToken(hit.chain, hit.token_address)}
                className="flex items-center justify-between gap-2 rounded-[var(--terminal-radius-card)] border border-terminal-border bg-terminal-bg-secondary px-2 py-1.5 text-left text-[10px] hover:border-terminal-border-active hover:bg-terminal-bg-tertiary transition-colors"
              >
                <span className="truncate text-terminal-text">
                  {hit.label ? `${hit.label} ` : ''}
                  deployer shipped <span className="font-mono">{truncateAddress(hit.token_address)}</span> on{' '}
                  {hit.chain}
                </span>
                <span className="shrink-0 text-terminal-text-muted">{timeAgo(hit.detected_at)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
