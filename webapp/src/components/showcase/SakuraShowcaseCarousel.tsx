/**
 * SakuraShowcaseCarousel — Ornate horizontal scrolling feature/promo cards
 * with floating sakura petals, glass-morphism overlays, and staggered reveals.
 */

import { useRef, useState, useEffect } from 'react'

// ─── Sakura Petal SVG ─────────────────────────────────────────────
function SakuraPetal({ className = '', style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C12 2 8 6 8 10C8 12.5 9.5 14 12 14C14.5 14 16 12.5 16 10C16 6 12 2 12 2Z"
        fill="currentColor"
        opacity="0.7"
      />
      <path
        d="M12 14C12 14 8 16 6 19C5 20.5 5.5 22 7 22C9 22 10.5 20.5 12 18C13.5 20.5 15 22 17 22C18.5 22 19 20.5 18 19C16 16 12 14 12 14Z"
        fill="currentColor"
        opacity="0.5"
      />
    </svg>
  )
}

// ─── Floating Petals Background ───────────────────────────────────
function FloatingPetals({ count = 8 }: { count?: number }) {
  const petals = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${(i * 13.7 + 5) % 100}%`,
    delay: `${i * 0.9}s`,
    duration: `${6 + (i % 4) * 1.5}s`,
    size: 10 + (i % 3) * 6,
    rotation: i * 45,
  }))

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {petals.map((p) => (
        <div
          key={p.id}
          className="absolute text-suwappu-sakura-300/40"
          style={{
            left: p.left,
            top: '-20px',
            animation: `sakura-drift ${p.duration} ease-in-out ${p.delay} infinite`,
            transform: `rotate(${p.rotation}deg)`,
          }}
        >
          <SakuraPetal style={{ width: p.size, height: p.size }} />
        </div>
      ))}
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────
export interface ShowcaseCard {
  id: string
  title: string
  subtitle: string
  description: string
  badge?: string
  badgeColor?: string
  gradient: string
  accentColor: string
  icon: string
  stats?: { label: string; value: string }[]
}

export interface SakuraShowcaseCarouselProps {
  cards: ShowcaseCard[]
  title?: string
  subtitle?: string
}

// ─── Showcase Card ────────────────────────────────────────────────
function ShowcaseCardItem({
  card,
  index,
  isVisible,
}: {
  card: ShowcaseCard
  index: number
  isVisible: boolean
}) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      className="flex-shrink-0 w-[300px] group"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(30px) scale(0.95)',
        transition: `all 600ms cubic-bezier(0.175, 0.885, 0.32, 1.275) ${index * 120}ms`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="relative h-[380px] rounded-suwappu-xxl overflow-hidden cursor-pointer"
        style={{
          background: card.gradient,
          transform: isHovered ? 'translateY(-8px) scale(1.02)' : 'translateY(0) scale(1)',
          boxShadow: isHovered
            ? `0 20px 50px rgba(106,27,154,0.2), 0 0 40px ${card.accentColor}33`
            : '0 8px 30px rgba(106,27,154,0.1)',
          transition: 'all 400ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}
      >
        {/* Glass overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 40%, rgba(0,0,0,0.2) 100%)',
          }}
        />

        {/* Ornate corner accents */}
        <div className="absolute top-3 left-3 w-8 h-8 border-t-2 border-l-2 border-white/30 rounded-tl-lg" />
        <div className="absolute top-3 right-3 w-8 h-8 border-t-2 border-r-2 border-white/30 rounded-tr-lg" />
        <div className="absolute bottom-3 left-3 w-8 h-8 border-b-2 border-l-2 border-white/30 rounded-bl-lg" />
        <div className="absolute bottom-3 right-3 w-8 h-8 border-b-2 border-r-2 border-white/30 rounded-br-lg" />

        {/* Decorative sakura motif — top right */}
        <div className="absolute top-6 right-6 text-white/20">
          <SakuraPetal style={{ width: 48, height: 48 }} />
        </div>

        {/* Badge */}
        {card.badge && (
          <div className="absolute top-5 left-5">
            <span
              className="px-3 py-1 rounded-suwappu-pill text-[10px] font-heading font-bold uppercase tracking-widest text-white backdrop-blur-md"
              style={{
                background: card.badgeColor || 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.3)',
              }}
            >
              {card.badge}
            </span>
          </div>
        )}

        {/* Content */}
        <div className="absolute bottom-0 left-0 right-0 p-5">
          {/* Icon */}
          <div
            className="w-12 h-12 rounded-suwappu-lg flex items-center justify-center text-2xl mb-3 backdrop-blur-sm"
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.25)',
              boxShadow: `0 4px 15px ${card.accentColor}33`,
            }}
          >
            {card.icon}
          </div>

          <h3 className="font-heading font-bold text-lg text-white mb-1 leading-tight">
            {card.title}
          </h3>
          <p className="text-xs font-heading font-medium text-white/70 uppercase tracking-wider mb-2">
            {card.subtitle}
          </p>
          <p className="text-sm text-white/80 leading-relaxed line-clamp-2 font-body">
            {card.description}
          </p>

          {/* Stats row */}
          {card.stats && card.stats.length > 0 && (
            <div className="flex gap-4 mt-3 pt-3 border-t border-white/15">
              {card.stats.map((stat) => (
                <div key={stat.label}>
                  <div className="text-sm font-heading font-bold text-white">{stat.value}</div>
                  <div className="text-[10px] text-white/50 uppercase tracking-wider">{stat.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hover shimmer line */}
        <div
          className="absolute top-0 left-0 w-full h-[2px]"
          style={{
            background: `linear-gradient(90deg, transparent, ${card.accentColor}88, transparent)`,
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 300ms',
          }}
        />
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────
export function SakuraShowcaseCarousel({ cards, title, subtitle }: SakuraShowcaseCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100)
    return () => clearTimeout(timer)
  }, [])

  const handleScroll = () => {
    if (!scrollRef.current) return
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
    setScrollProgress(scrollLeft / (scrollWidth - clientWidth))
  }

  return (
    <div className="relative py-8 overflow-hidden">
      {/* Background petals */}
      <FloatingPetals count={6} />

      {/* Section header */}
      {(title || subtitle) && (
        <div className="px-5 mb-6">
          {subtitle && (
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.2em] text-suwappu-magenta-mid/70 mb-1">
              {subtitle}
            </p>
          )}
          {title && (
            <h2 className="font-heading font-bold text-xl text-suwappu-purple-deep flex items-center gap-2">
              {title}
              <span className="text-suwappu-sakura-300">
                <SakuraPetal style={{ width: 16, height: 16 }} />
              </span>
            </h2>
          )}
        </div>
      )}

      {/* Scrollable track */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex gap-4 px-5 pb-4 overflow-x-auto scrollbar-hide scroll-smooth"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {cards.map((card, i) => (
          <ShowcaseCardItem key={card.id} card={card} index={i} isVisible={isVisible} />
        ))}
        {/* End spacer */}
        <div className="flex-shrink-0 w-1" />
      </div>

      {/* Scroll progress indicator */}
      <div className="mx-5 mt-4 h-[2px] rounded-full bg-suwappu-sakura-200/40 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-150"
          style={{
            width: `${Math.max(20, scrollProgress * 100)}%`,
            background: 'linear-gradient(90deg, #FFB7C5, #C44569, #6C3483)',
          }}
        />
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes sakura-drift {
          0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
          10% { opacity: 0.7; }
          50% { translateX: 30px; }
          90% { opacity: 0.7; }
          100% { transform: translateY(calc(100% + 400px)) translateX(60px) rotate(360deg); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
