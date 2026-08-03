import { useMemo, useState } from 'react'
import type { IntelHolder } from '../../types/api'
import { bubbleRadius, clusterColor, hashString, seededRandom, truncateAddress, formatPct } from '../../lib/intelFormat'
import { TerminalEmptyState } from '../foundation'

interface BubbleMapProps {
  holders: IntelHolder[]
  clusterGroups: string[][]
}

const VBOX = 300
const CENTER = VBOX / 2
const PAD = 6

function clamp(value: number, r: number): number {
  return Math.max(r + PAD, Math.min(VBOX - r - PAD, value))
}

function clusterIndexOf(address: string, clusterGroups: string[][]): number {
  const lower = address.toLowerCase()
  for (let i = 0; i < clusterGroups.length; i++) {
    if (clusterGroups[i].some((a) => a.toLowerCase() === lower)) return i
  }
  return -1
}

interface PositionedHolder {
  holder: IntelHolder
  x: number
  y: number
  r: number
  clusterIdx: number
  color: string
  anchorX: number
  anchorY: number
}

// Deterministic layout: every bubble's position is seeded from its address
// (and, for clustered holders, its cluster anchor), so the same intel data
// always renders the same map — no reshuffle on rerender.
function layoutHolders(holders: IntelHolder[], clusterGroups: string[][]): PositionedHolder[] {
  const withCluster = holders.map((h) => ({ holder: h, clusterIdx: clusterIndexOf(h.address, clusterGroups) }))

  // Stable, ordered list of cluster indices actually represented among the
  // rendered holders (angle assignment is index-based, not random, so
  // clusters never overlap each other's anchor).
  const activeClusterIdxs = Array.from(new Set(withCluster.map((w) => w.clusterIdx).filter((i) => i >= 0))).sort(
    (a, b) => a - b
  )

  const anchorFor = (clusterIdx: number): { x: number; y: number } => {
    const slot = activeClusterIdxs.indexOf(clusterIdx)
    const count = activeClusterIdxs.length
    const baseAngle = (slot / Math.max(count, 1)) * Math.PI * 2
    const group = clusterGroups[clusterIdx] ?? []
    const jitterSeed = hashString(group.join('|') || String(clusterIdx))
    const jitter = (seededRandom(jitterSeed)() - 0.5) * 0.4
    const angle = baseAngle + jitter
    const ringRadius = 78
    return {
      x: CENTER + Math.cos(angle) * ringRadius,
      y: CENTER + Math.sin(angle) * ringRadius,
    }
  }

  return withCluster.map(({ holder, clusterIdx }) => {
    const r = bubbleRadius(holder.pct)
    const seed = hashString(holder.address)
    const rand = seededRandom(seed)

    let x: number
    let y: number
    let anchorX: number
    let anchorY: number

    if (clusterIdx >= 0) {
      const anchor = anchorFor(clusterIdx)
      anchorX = anchor.x
      anchorY = anchor.y
      const offsetAngle = rand() * Math.PI * 2
      const offsetRadius = 10 + rand() * 24
      x = anchor.x + Math.cos(offsetAngle) * offsetRadius
      y = anchor.y + Math.sin(offsetAngle) * offsetRadius
    } else {
      // Unclustered holders spread across the outer field, still fully
      // deterministic from their own address hash.
      const angle = rand() * Math.PI * 2
      const radius = 40 + rand() * 110
      x = CENTER + Math.cos(angle) * radius
      y = CENTER + Math.sin(angle) * radius
      anchorX = x
      anchorY = y
    }

    return {
      holder,
      x: clamp(x, r),
      y: clamp(y, r),
      r,
      clusterIdx,
      color: clusterColor(clusterIdx),
      anchorX: clamp(anchorX, 2),
      anchorY: clamp(anchorY, 2),
    }
  })
}

export function BubbleMap({ holders, clusterGroups }: BubbleMapProps) {
  const [activeAddress, setActiveAddress] = useState<string | null>(null)

  // Bigger bubbles first so smaller ones render on top and stay clickable.
  const sorted = useMemo(() => [...holders].sort((a, b) => b.pct - a.pct), [holders])
  const positioned = useMemo(() => layoutHolders(sorted, clusterGroups), [sorted, clusterGroups])

  if (!holders || holders.length === 0) {
    return (
      <TerminalEmptyState
        title="No holder data"
        description="Holder distribution wasn't available for this token."
      />
    )
  }

  const active = positioned.find((p) => p.holder.address === activeAddress) ?? null

  return (
    <div className="relative mx-auto w-full max-w-[420px] select-none" data-testid="bubble-map">
      <svg
        viewBox={`0 0 ${VBOX} ${VBOX}`}
        className="aspect-square w-full overflow-visible"
        role="img"
        aria-label="Holder bubble map"
      >
        {/* Cluster links: connect each member back to its cluster anchor. */}
        {positioned
          .filter((p) => p.clusterIdx >= 0)
          .map((p) => (
            <line
              key={`link-${p.holder.address}`}
              x1={p.anchorX}
              y1={p.anchorY}
              x2={p.x}
              y2={p.y}
              stroke={p.color}
              strokeOpacity={0.35}
              strokeWidth={1}
            />
          ))}

        {positioned.map((p) => {
          const isActive = p.holder.address === activeAddress
          return (
            <circle
              key={p.holder.address}
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill={p.color}
              fillOpacity={p.clusterIdx >= 0 ? 0.55 : 0.35}
              stroke={isActive ? '#ffffff' : p.color}
              strokeWidth={isActive ? 2 : 1}
              className="cursor-pointer transition-[fill-opacity] duration-150"
              onMouseEnter={() => setActiveAddress(p.holder.address)}
              onMouseLeave={() => setActiveAddress((prev) => (prev === p.holder.address ? null : prev))}
              onClick={() => setActiveAddress((prev) => (prev === p.holder.address ? null : p.holder.address))}
            >
              <title>
                {`${truncateAddress(p.holder.address)} — ${formatPct(p.holder.pct)}${p.clusterIdx >= 0 ? ` (cluster ${p.clusterIdx + 1})` : ''}`}
              </title>
            </circle>
          )
        })}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute left-1/2 top-1 z-10 -translate-x-1/2 rounded-[var(--terminal-radius-card)] border border-terminal-border bg-terminal-bg-secondary px-2.5 py-1.5 text-[10px] leading-4 text-terminal-text shadow-lg"
          data-testid="bubble-tooltip"
        >
          <div className="font-mono">{truncateAddress(active.holder.address)}</div>
          <div className="text-terminal-text-secondary">
            {formatPct(active.holder.pct)}
            {' · '}
            {active.clusterIdx >= 0 ? `Cluster ${active.clusterIdx + 1} of ${clusterGroups.length}` : 'Unclustered'}
          </div>
        </div>
      )}

      <div className="mt-1 text-center text-[9px] text-terminal-text-muted">
        Bubble area = share of supply. Same color + linked = same cluster. Hover / tap for detail.
      </div>
    </div>
  )
}
