/**
 * Ambient cherry-blossom petals drifting down behind the realm UI.
 * Pure CSS animation (reuses .suwappu-petal keyframes), pointer-events: none.
 */

interface FloatingPetalsProps {
  count?: number
  className?: string
}

export function FloatingPetals({ count = 12, className = '' }: FloatingPetalsProps) {
  const petals = Array.from({ length: count })
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {petals.map((_, i) => {
        const left = (i * 97) % 100
        const delay = (i % 6) * 1.3
        const duration = 7 + (i % 5) * 1.5
        const size = 8 + (i % 4) * 4
        const opacity = 0.35 + (i % 4) * 0.12
        return (
          <span
            key={i}
            className="suwappu-petal absolute top-[-24px] select-none"
            style={{
              left: `${left}%`,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s, 3s, 2s`,
              fontSize: `${size}px`,
              opacity,
            }}
          >
            🌸
          </span>
        )
      })}
    </div>
  )
}
