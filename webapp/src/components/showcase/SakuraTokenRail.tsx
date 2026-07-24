/**
 * SakuraTokenRail — Ornate horizontal scrolling token/chain cards
 * with sparkline prices, chain badge glow effects, and petal accents.
 */

import { useRef, useState, useEffect } from 'react'

// ─── Mini Sparkline SVG ──────────────────────────────────────────
function Sparkline({
  data,
  color,
  width = 64,
  height = 24,
}: {
  data: number[]
  color: string
  width?: number
  height?: number
}) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * height
      return `${x},${y}`
    })
    .join(' ')

  const gradientId = `spark-${color.replace('#', '')}`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Fill area */}
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#${gradientId})`}
      />
      {/* Line */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End dot */}
      <circle
        cx={width}
        cy={parseFloat(points.split(' ').pop()!.split(',')[1])}
        r="2"
        fill={color}
      />
    </svg>
  )
}

// ─── Chain Glow Badge ────────────────────────────────────────────
function ChainGlowBadge({ chain, color }: { chain: string; color: string }) {
  return (
    <div className="relative">
      {/* Glow ring */}
      <div
        className="absolute inset-0 rounded-full blur-sm"
        style={{ background: color, opacity: 0.4 }}
      />
      <div
        className="relative w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-heading font-bold text-white uppercase"
        style={{
          background: `linear-gradient(135deg, ${color}, ${color}CC)`,
          border: `1.5px solid ${color}66`,
          boxShadow: `0 0 8px ${color}44`,
        }}
      >
        {chain.slice(0, 2)}
      </div>
    </div>
  )
}

// ─── Types ───────────────────────────────────────────────────────
export interface TokenRailItem {
  id: string
  symbol: string
  name: string
  chain: string
  chainColor: string
  price: string
  change24h: number
  sparklineData: number[]
  icon: string
  balance?: string
}

export interface SakuraTokenRailProps {
  tokens: TokenRailItem[]
  title?: string
  subtitle?: string
}

// ─── Token Card ──────────────────────────────────────────────────
function TokenCard({
  token,
  index,
  isVisible,
}: {
  token: TokenRailItem
  index: number
  isVisible: boolean
}) {
  const [isHovered, setIsHovered] = useState(false)
  const isPositive = token.change24h >= 0
  const changeColor = isPositive ? '#4ADE80' : '#F87171'

  return (
    <div
      className="shrink-0 w-[200px]"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateX(0) scale(1)' : 'translateX(20px) scale(0.9)',
        transition: `all 500ms cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 80}ms`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="relative rounded-suwappu-xl overflow-hidden cursor-pointer"
        style={{
          background: 'linear-gradient(135deg, rgba(255,251,252,0.95), rgba(255,209,220,0.15))',
          border: '1px solid rgba(255,183,197,0.3)',
          transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
          boxShadow: isHovered
            ? `0 12px 32px rgba(106,27,154,0.12), 0 0 20px ${token.chainColor}22`
            : '0 4px 16px rgba(106,27,154,0.06)',
          transition: 'all 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}
      >
        {/* Top decorative line */}
        <div
          className="h-[2px]"
          style={{
            background: `linear-gradient(90deg, transparent, ${token.chainColor}88, transparent)`,
          }}
        />

        <div className="p-3.5">
          {/* Header: icon + chain badge */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{token.icon}</span>
              <div>
                <div className="font-heading font-bold text-sm text-suwappu-text leading-tight">
                  {token.symbol}
                </div>
                <div className="text-[10px] text-suwappu-text-secondary truncate max-w-[80px]">
                  {token.name}
                </div>
              </div>
            </div>
            <ChainGlowBadge chain={token.chain} color={token.chainColor} />
          </div>

          {/* Sparkline */}
          <div className="mb-3">
            <Sparkline data={token.sparklineData} color={changeColor} width={172} height={32} />
          </div>

          {/* Price + change */}
          <div className="flex items-end justify-between">
            <div className="font-heading font-bold text-sm text-suwappu-text">
              {token.price}
            </div>
            <div
              className="flex items-center gap-0.5 text-[11px] font-heading font-semibold px-1.5 py-0.5 rounded-full"
              style={{
                color: changeColor,
                background: isPositive ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
              }}
            >
              <span>{isPositive ? '▲' : '▼'}</span>
              <span>{Math.abs(token.change24h).toFixed(1)}%</span>
            </div>
          </div>

          {/* Balance (if present) */}
          {token.balance && (
            <div className="mt-2 pt-2 border-t border-suwappu-sakura-mid/20">
              <div className="text-[10px] text-suwappu-text-secondary font-body">
                Balance: <span className="font-heading font-semibold text-suwappu-text">{token.balance}</span>
              </div>
            </div>
          )}
        </div>

        {/* Hover accent bottom border */}
        <div
          className="h-[2px]"
          style={{
            background: `linear-gradient(90deg, ${token.chainColor}66, ${token.chainColor}, ${token.chainColor}66)`,
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 250ms',
          }}
        />
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────
export function SakuraTokenRail({ tokens, title, subtitle }: SakuraTokenRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 80)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="relative py-6">
      {/* Section header */}
      {(title || subtitle) && (
        <div className="px-5 mb-4">
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

      {/* Scrollable rail */}
      <div
        ref={scrollRef}
        className="flex gap-3 px-5 pb-3 overflow-x-auto scrollbar-hide scroll-smooth"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {tokens.map((token, i) => (
          <TokenCard key={token.id} token={token} index={i} isVisible={isVisible} />
        ))}
        <div className="shrink-0 w-1" />
      </div>
    </div>
  )
}
