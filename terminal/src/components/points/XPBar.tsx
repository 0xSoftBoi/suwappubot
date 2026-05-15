import { useEffect, useState } from 'react'

interface XPBarProps {
  xp: number
  level: number
  currentLevelXp: number
  nextLevelXp: number
}

export function XPBar({ xp, level, currentLevelXp, nextLevelXp }: XPBarProps) {
  const [animatedWidth, setAnimatedWidth] = useState(0)
  const progressInLevel = xp - currentLevelXp
  const levelRange = nextLevelXp - currentLevelXp
  const percentage = levelRange > 0 ? Math.min((progressInLevel / levelRange) * 100, 100) : 0

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedWidth(percentage), 100)
    return () => clearTimeout(timer)
  }, [percentage])

  return (
    <div className="flex flex-col gap-2" data-testid="xp-bar">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-terminal-text-secondary uppercase tracking-wider">Level</span>
          <span className="font-mono text-lg font-bold text-sakura-400">{level}</span>
        </div>
        <span className="font-mono text-xs text-terminal-text-secondary">
          {xp.toLocaleString()} / {nextLevelXp.toLocaleString()} XP
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-terminal-bg overflow-hidden border border-terminal-border">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${animatedWidth}%`,
            background: 'var(--terminal-button-background)',
          }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full opacity-40 animate-shimmer"
          style={{
            width: `${animatedWidth}%`,
            backgroundSize: '200% 100%',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
          }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-terminal-text-muted">
        <span>{progressInLevel.toLocaleString()} XP this level</span>
        <span>{Math.max(0, nextLevelXp - xp).toLocaleString()} XP to next</span>
      </div>
    </div>
  )
}
