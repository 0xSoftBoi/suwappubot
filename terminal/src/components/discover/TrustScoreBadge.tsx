interface TrustScoreBadgeProps {
  score?: number
  level?: 'safe' | 'caution' | 'danger'
}

export function TrustScoreBadge({ score, level }: TrustScoreBadgeProps) {
  if (score === undefined) return null

  const colorClass =
    level === 'safe' || (!level && score >= 80)
      ? 'bg-green-500/20 text-green-400 border-green-500/30'
      : level === 'caution' || (!level && score >= 50)
        ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
        : 'bg-red-500/20 text-red-400 border-red-500/30'

  return (
    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-mono border ${colorClass}`}>
      {score}
    </span>
  )
}
