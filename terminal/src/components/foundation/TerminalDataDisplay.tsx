import type { ReactNode } from 'react'

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

const chainMeta: Record<string, { label: string; className: string }> = {
  ethereum: { label: 'ETH', className: 'bg-chain-ethereum text-white' },
  arbitrum: { label: 'ARB', className: 'bg-chain-arbitrum text-white' },
  base: { label: 'BASE', className: 'bg-chain-base text-white' },
  optimism: { label: 'OP', className: 'bg-chain-optimism text-white' },
  polygon: { label: 'POLY', className: 'bg-chain-polygon text-white' },
  bsc: { label: 'BSC', className: 'bg-chain-bsc text-terminal-text' },
  avalanche: { label: 'AVAX', className: 'bg-chain-avalanche text-white' },
  solana: { label: 'SOL', className: 'bg-chain-solana text-white' },
  sui: { label: 'SUI', className: 'bg-chain-sui text-white' },
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function TerminalChainBadge({ chain }: { chain: string }) {
  const meta = chainMeta[chain] || {
    label: chain.slice(0, 4).toUpperCase(),
    className: 'bg-terminal-border-active text-white',
  }

  return (
    <span
      className={joinClasses(
        'inline-flex rounded-suwappu-pill px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em]',
        meta.className,
      )}
    >
      {meta.label}
    </span>
  )
}

export function TerminalDeltaText({
  value,
  loading = false,
  align = 'right',
}: {
  value: number | null
  loading?: boolean
  align?: 'left' | 'right'
}) {
  if (loading) {
    return (
      <span className="inline-block h-3 w-12 rounded bg-terminal-bg-tertiary animate-shimmer" />
    )
  }

  if (value === null) {
    return <span className="text-terminal-text-muted">--</span>
  }

  const positive = value >= 0
  return (
    <span
      className={joinClasses(
        'font-mono text-xs',
        align === 'right' ? 'text-right' : '',
        positive ? 'text-bull' : 'text-bear',
      )}
    >
      {formatPercent(value)}
    </span>
  )
}

export function TerminalKeyValueRow({
  label,
  value,
  detail,
}: {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-suwappu-xl border border-terminal-border bg-white/90 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-text-muted">
          {label}
        </div>
        {detail ? <div className="mt-1 text-xs text-terminal-text-secondary">{detail}</div> : null}
      </div>
      <div className="text-sm font-semibold text-terminal-text">{value}</div>
    </div>
  )
}
