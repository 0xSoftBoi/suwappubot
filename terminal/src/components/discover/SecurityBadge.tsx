import type { TokenSecurity } from '../../types/api'

const RISK_CONFIG = {
  safe: {
    label: 'Safe',
    dotClass: 'bg-green-500',
    borderClass: 'border-green-500/30',
    textClass: 'text-green-400',
  },
  caution: {
    label: 'Caution',
    dotClass: 'bg-yellow-500',
    borderClass: 'border-yellow-500/30',
    textClass: 'text-yellow-400',
  },
  danger: {
    label: 'Danger',
    dotClass: 'bg-red-500',
    borderClass: 'border-red-500/30',
    textClass: 'text-red-400',
  },
} as const

interface SecurityBadgeProps {
  security: TokenSecurity | null | undefined
  loading?: boolean
}

export function SecurityBadge({ security, loading }: SecurityBadgeProps) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-terminal-border text-terminal-text-muted animate-pulse">
        ...
      </span>
    )
  }

  if (!security) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-terminal-border text-terminal-text-muted">
        N/A
      </span>
    )
  }

  const config = RISK_CONFIG[security.riskLevel]

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${config.borderClass} ${config.textClass}`}
      title={`Honeypot: ${security.isHoneypot ? 'Yes' : 'No'} | Owner Renounced: ${security.ownerRenounced ? 'Yes' : 'No'} | LP Burned: ${security.lpBurned}% | Top Holder: ${security.topHolderPercent}%`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </span>
  )
}
