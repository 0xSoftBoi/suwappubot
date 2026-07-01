/**
 * SakuraDenseTimeline — Compact horizontal scrolling feed of
 * transaction/activity items with sakura accent spine and glass chips.
 */

import { useRef, useState, useEffect } from 'react'

// ─── Types ───────────────────────────────────────────────────────
export interface DenseTimelineItem {
  id: string
  type: 'swap' | 'bridge' | 'send' | 'receive' | 'approve' | 'stake'
  title: string
  amount: string
  timestamp: string
  status: 'completed' | 'pending' | 'failed'
  fromChain?: string
  toChain?: string
  chainColor?: string
  toChainColor?: string
}

export interface SakuraDenseTimelineProps {
  items: DenseTimelineItem[]
  title?: string
  subtitle?: string
}

// ─── Type Icons ──────────────────────────────────────────────────
const typeConfig: Record<string, { icon: string; accent: string }> = {
  swap: { icon: '⇄', accent: '#E91E8C' },
  bridge: { icon: '🌉', accent: '#8B5CF6' },
  send: { icon: '↗', accent: '#F97316' },
  receive: { icon: '↙', accent: '#22C55E' },
  approve: { icon: '✓', accent: '#3B82F6' },
  stake: { icon: '⚡', accent: '#F59E0B' },
}

const statusDot: Record<string, string> = {
  completed: '#4ADE80',
  pending: '#F59E0B',
  failed: '#EF4444',
}

// ─── Dense Item Chip ─────────────────────────────────────────────
function DenseChip({
  item,
  index,
  isVisible,
}: {
  item: DenseTimelineItem
  index: number
  isVisible: boolean
}) {
  const [isHovered, setIsHovered] = useState(false)
  const config = typeConfig[item.type] || typeConfig.swap

  return (
    <div
      className="shrink-0"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.95)',
        transition: `all 400ms ease-out ${index * 60}ms`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="relative flex items-center gap-2.5 px-3.5 py-2.5 rounded-suwappu-xl cursor-pointer"
        style={{
          background: isHovered
            ? 'rgba(255,251,252,0.98)'
            : 'rgba(255,251,252,0.9)',
          border: `1px solid ${isHovered ? `${config.accent}33` : 'rgba(255,183,197,0.2)'}`,
          backdropFilter: 'blur(12px)',
          boxShadow: isHovered
            ? `0 8px 24px rgba(106,27,154,0.08), 0 0 0 1px ${config.accent}11`
            : '0 2px 8px rgba(106,27,154,0.03)',
          transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
          transition: 'all 250ms ease',
        }}
      >
        {/* Type icon with accent ring */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
          style={{
            background: `${config.accent}12`,
            border: `1.5px solid ${config.accent}30`,
            color: config.accent,
          }}
        >
          {config.icon}
        </div>

        {/* Content */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-heading font-bold text-xs text-suwappu-text truncate">
              {item.title}
            </span>
            {/* Status dot */}
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                background: statusDot[item.status] || statusDot.pending,
                boxShadow: item.status === 'pending' ? `0 0 4px ${statusDot.pending}` : 'none',
                animation: item.status === 'pending' ? 'dense-blink 2s ease-in-out infinite' : 'none',
              }}
            />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] font-heading font-semibold text-suwappu-text">
              {item.amount}
            </span>
            <span className="text-[9px] text-suwappu-text-secondary font-body">
              {item.timestamp}
            </span>
          </div>
        </div>

        {/* Chain indicators */}
        {item.fromChain && (
          <div className="flex items-center gap-1 ml-1 shrink-0">
            <div
              className="w-4 h-4 rounded-full border border-white/60"
              style={{ background: item.chainColor || '#627EEA' }}
            />
            {item.toChain && (
              <>
                <span className="text-[8px] text-suwappu-text-secondary">→</span>
                <div
                  className="w-4 h-4 rounded-full border border-white/60"
                  style={{ background: item.toChainColor || '#627EEA' }}
                />
              </>
            )}
          </div>
        )}

        {/* Top accent line */}
        <div
          className="absolute top-0 left-3 right-3 h-[1px]"
          style={{
            background: `linear-gradient(90deg, transparent, ${config.accent}44, transparent)`,
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 200ms',
          }}
        />
      </div>
    </div>
  )
}

// ─── Sakura Spine ────────────────────────────────────────────────
function SakuraSpine() {
  return (
    <div className="relative h-[3px] mx-5 rounded-full overflow-hidden mb-4">
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, #FFD1DC, #FFB7C5, #F8A5C2, #C44569, #6C3483, #C44569, #F8A5C2, #FFB7C5, #FFD1DC)',
          backgroundSize: '200% 100%',
          animation: 'spine-flow 8s linear infinite',
        }}
      />
      {/* Small petal dots along spine */}
      {[15, 35, 55, 75].map((pos) => (
        <div
          key={pos}
          className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white/60"
          style={{ left: `${pos}%` }}
        />
      ))}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────
export function SakuraDenseTimeline({ items, title, subtitle }: SakuraDenseTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 60)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="relative py-5">
      {/* Section header */}
      {(title || subtitle) && (
        <div className="px-5 mb-3">
          {subtitle && (
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.2em] text-suwappu-magenta-mid/70 mb-0.5">
              {subtitle}
            </p>
          )}
          {title && (
            <h2 className="font-heading font-bold text-lg text-suwappu-purple-deep">
              {title}
            </h2>
          )}
        </div>
      )}

      {/* Decorative spine */}
      <SakuraSpine />

      {/* Scrollable feed */}
      <div
        ref={scrollRef}
        className="flex gap-2.5 px-5 pb-3 overflow-x-auto scrollbar-hide scroll-smooth"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {items.map((item, i) => (
          <DenseChip key={item.id} item={item} index={i} isVisible={isVisible} />
        ))}
        <div className="shrink-0 w-1" />
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes dense-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spine-flow {
          0% { background-position: 0% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  )
}
