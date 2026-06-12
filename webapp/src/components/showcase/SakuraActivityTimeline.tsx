/**
 * SakuraActivityTimeline — Ornate horizontal scrolling timeline
 * with sakura branch connector, bloom node animations, and glass cards.
 */

import { useRef, useState, useEffect } from 'react'

// ─── Sakura Bloom Node ───────────────────────────────────────────
function BloomNode({
  status,
  isActive,
}: {
  status: 'completed' | 'pending' | 'active' | 'failed'
  isActive: boolean
}) {
  const colors: Record<string, { bg: string; ring: string; glow: string }> = {
    completed: { bg: '#FFB7C5', ring: '#F8A5C2', glow: 'rgba(255,183,197,0.4)' },
    active: { bg: '#E91E8C', ring: '#C44569', glow: 'rgba(233,30,140,0.35)' },
    pending: { bg: '#E8F4FD', ring: '#B3E5FC', glow: 'rgba(135,206,235,0.2)' },
    failed: { bg: '#F8A0A0', ring: '#EF4444', glow: 'rgba(239,68,68,0.3)' },
  }
  const c = colors[status] || colors.pending

  return (
    <div className="relative flex items-center justify-center">
      {/* Glow pulse for active */}
      {status === 'active' && (
        <div
          className="absolute w-10 h-10 rounded-full"
          style={{
            background: c.glow,
            animation: 'bloom-pulse 2s ease-in-out infinite',
          }}
        />
      )}
      {/* Outer ring */}
      <div
        className="relative w-7 h-7 rounded-full flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${c.bg}, ${c.ring})`,
          boxShadow: `0 2px 8px ${c.glow}`,
          border: `2px solid ${isActive ? c.ring : 'rgba(255,255,255,0.6)'}`,
          transform: isActive ? 'scale(1.15)' : 'scale(1)',
          transition: 'transform 300ms ease',
        }}
      >
        {/* Inner icon */}
        {status === 'completed' && (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="white">
            <path d="M6.5 12L2 7.5L3.5 6L6.5 9L12.5 3L14 4.5L6.5 12Z" />
          </svg>
        )}
        {status === 'active' && (
          <div className="w-2.5 h-2.5 rounded-full bg-white" style={{ animation: 'bloom-dot 1.5s ease-in-out infinite' }} />
        )}
        {status === 'failed' && (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="white">
            <path d="M4 4L12 12M12 4L4 12" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        )}
        {status === 'pending' && (
          <div className="w-2 h-2 rounded-full bg-white/60" />
        )}
      </div>
      {/* Petal accent (completed only) */}
      {status === 'completed' && (
        <svg
          className="absolute -top-1 -right-1 text-suwappu-sakura-300/50"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2C12 2 8 6 8 10C8 12.5 9.5 14 12 14C14.5 14 16 12.5 16 10C16 6 12 2 12 2Z" opacity="0.8" />
        </svg>
      )}
    </div>
  )
}

// ─── Branch Connector ────────────────────────────────────────────
function BranchConnector({ isCompleted }: { isCompleted: boolean }) {
  return (
    <div className="relative flex-shrink-0 w-20 flex items-center">
      {/* Main branch line */}
      <div
        className="w-full h-[2px] rounded-full"
        style={{
          background: isCompleted
            ? 'linear-gradient(90deg, #FFB7C5, #F8A5C2)'
            : 'linear-gradient(90deg, #E8F4FD, #B3E5FC)',
        }}
      />
      {/* Small petal along branch */}
      {isCompleted && (
        <svg
          className="absolute left-1/2 -translate-x-1/2 -top-2 text-suwappu-sakura-300/30"
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2C12 2 8 6 8 10C8 12.5 9.5 14 12 14C14.5 14 16 12.5 16 10C16 6 12 2 12 2Z" />
        </svg>
      )}
    </div>
  )
}

// ─── Types ───────────────────────────────────────────────────────
export interface TimelineEvent {
  id: string
  title: string
  description: string
  timestamp: string
  status: 'completed' | 'pending' | 'active' | 'failed'
  icon: string
  detail?: string
  chain?: string
  chainColor?: string
}

export interface SakuraActivityTimelineProps {
  events: TimelineEvent[]
  title?: string
  subtitle?: string
}

// ─── Event Card ──────────────────────────────────────────────────
function EventCard({
  event,
  index,
  isVisible,
  isActive,
}: {
  event: TimelineEvent
  index: number
  isVisible: boolean
  isActive: boolean
}) {
  const statusBg: Record<string, string> = {
    completed: 'rgba(255,183,197,0.08)',
    active: 'rgba(233,30,140,0.06)',
    pending: 'rgba(232,244,253,0.6)',
    failed: 'rgba(248,160,160,0.08)',
  }

  return (
    <div
      className="flex flex-col items-center flex-shrink-0"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(16px)',
        transition: `all 450ms ease-out ${index * 100}ms`,
      }}
    >
      {/* Card */}
      <div
        className="w-[180px] rounded-suwappu-xl p-3.5 mb-3 cursor-pointer"
        style={{
          background: statusBg[event.status] || statusBg.pending,
          border: `1px solid ${isActive ? 'rgba(233,30,140,0.2)' : 'rgba(255,183,197,0.2)'}`,
          backdropFilter: 'blur(8px)',
          boxShadow: isActive
            ? '0 8px 24px rgba(233,30,140,0.1)'
            : '0 2px 12px rgba(106,27,154,0.04)',
          transition: 'all 300ms ease',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{event.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="font-heading font-bold text-xs text-suwappu-text truncate">
              {event.title}
            </div>
            <div className="text-[9px] text-suwappu-text-secondary font-body">
              {event.timestamp}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-suwappu-text-secondary font-body leading-relaxed line-clamp-2 mb-2">
          {event.description}
        </p>

        {/* Chain tag */}
        {event.chain && (
          <div className="flex items-center gap-1">
            <div
              className="w-3 h-3 rounded-full"
              style={{ background: event.chainColor || '#627EEA' }}
            />
            <span className="text-[9px] font-heading font-medium text-suwappu-text-secondary uppercase tracking-wider">
              {event.chain}
            </span>
          </div>
        )}

        {event.detail && (
          <div className="mt-2 pt-2 border-t border-suwappu-sakura-mid/15">
            <span className="text-[10px] font-heading font-semibold text-suwappu-magenta-mid">
              {event.detail}
            </span>
          </div>
        )}
      </div>

      {/* Bloom node */}
      <BloomNode status={event.status} isActive={isActive} />
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────
export function SakuraActivityTimeline({ events, title, subtitle }: SakuraActivityTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [activeIndex, setActiveIndex] = useState(
    events.findIndex((e) => e.status === 'active')
  )

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100)
    return () => clearTimeout(timer)
  }, [])

  // Auto-scroll to active event
  useEffect(() => {
    if (activeIndex >= 0 && scrollRef.current) {
      const cardWidth = 180 + 80 // card + connector
      const scrollTo = Math.max(0, activeIndex * cardWidth - scrollRef.current.clientWidth / 2 + 90)
      scrollRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' })
    }
  }, [activeIndex, isVisible])

  return (
    <div className="relative py-6">
      {/* Section header */}
      {(title || subtitle) && (
        <div className="px-5 mb-5">
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

      {/* Scrollable timeline */}
      <div
        ref={scrollRef}
        className="flex items-end px-5 pb-4 overflow-x-auto scrollbar-hide scroll-smooth"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {events.map((event, i) => (
          <div key={event.id} className="flex items-end">
            <div onClick={() => setActiveIndex(i)}>
              <EventCard
                event={event}
                index={i}
                isVisible={isVisible}
                isActive={i === activeIndex}
              />
            </div>
            {i < events.length - 1 && (
              <div className="mb-[14px]">
                <BranchConnector isCompleted={event.status === 'completed'} />
              </div>
            )}
          </div>
        ))}
        <div className="flex-shrink-0 w-4" />
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes bloom-pulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.4); opacity: 0.15; }
        }
        @keyframes bloom-dot {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(0.6); }
        }
      `}</style>
    </div>
  )
}
