import type { TierName } from '../../types/api'

const TIER_COLORS: Record<TierName, string> = {
  Bronze: '#CD7F32',
  Silver: '#C0C0C0',
  Gold: '#FFD700',
  Platinum: '#E5E4E2',
  Diamond: '#B9F2FF',
}

const TIER_ICONS: Record<TierName, string> = {
  Bronze: '\u25C6',
  Silver: '\u25C7',
  Gold: '\u2605',
  Platinum: '\u2726',
  Diamond: '\u2666',
}

interface TierBadgeProps {
  tier: TierName
  points: number
  compact?: boolean
}

export function TierBadge({ tier, points, compact = false }: TierBadgeProps) {
  const color = TIER_COLORS[tier]
  const icon = TIER_ICONS[tier]

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold"
        style={{ color, borderColor: color, border: '1px solid' }}
        data-testid="tier-badge"
      >
        <span>{icon}</span>
        <span>{tier}</span>
      </span>
    )
  }

  return (
    <div
      className="flex flex-col items-center gap-1 p-3 rounded-lg border"
      style={{ borderColor: `${color}40`, backgroundColor: `${color}08` }}
      data-testid="tier-badge"
    >
      <div
        className="text-3xl leading-none"
        style={{ color, textShadow: `0 0 12px ${color}60` }}
      >
        {icon}
      </div>
      <span className="text-sm font-bold tracking-wide" style={{ color }}>
        {tier}
      </span>
      <span className="font-mono text-xs text-terminal-text-secondary">
        {points.toLocaleString()} XP
      </span>
    </div>
  )
}
