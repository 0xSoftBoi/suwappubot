import React, { useState, useMemo } from 'react'
import { ChainBadge } from './ChainBadge'
import { ProviderLogo } from './ProviderLogo'

export interface RouteHop {
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  provider: string
  type: 'swap' | 'bridge'
  fee?: number // USD
  estimatedTime?: string
  poolInfo?: string // "Uniswap V3 0.3%"
}

export interface SwapRouteVisualizerProps {
  hops: RouteHop[]
  mode?: 'compact' | 'expanded'
  onToggleMode?: () => void
  className?: string
}

/** Small bridge icon for bridge-type hops */
function BridgeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 18V12C4 9.79 5.79 8 8 8h8c2.21 0 4 1.79 4 4v6" />
      <path d="M2 18h20" />
      <path d="M6 8V6" />
      <path d="M18 8V6" />
    </svg>
  )
}

/** Arrow SVG for compact mode */
function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
    </svg>
  )
}

/** Expand/collapse chevron */
function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

// ──────────────────────────────────────────────
// Token circle: gradient circle with 2-char symbol
// ──────────────────────────────────────────────
function TokenCircle({ symbol }: { symbol: string }) {
  return (
    <div className="w-8 h-8 rounded-suwappu-pill bg-suwappu-gradient flex items-center justify-center shrink-0">
      <span className="text-white text-xs font-bold leading-none select-none">
        {symbol.slice(0, 2).toUpperCase()}
      </span>
    </div>
  )
}

// ──────────────────────────────────────────────
// Fee summary helpers
// ──────────────────────────────────────────────
function computeTotalFees(hops: RouteHop[]): number {
  return hops.reduce((sum, h) => sum + (h.fee ?? 0), 0)
}

function parseSeconds(est: string): number {
  // Handle formats like "~2min", "~5s", "~2min 10s", "~15s"
  let totalSeconds = 0
  const minMatch = est.match(/(\d+)\s*min/)
  const secMatch = est.match(/(\d+)\s*s(?:ec)?/)
  if (minMatch) totalSeconds += parseInt(minMatch[1], 10) * 60
  if (secMatch) totalSeconds += parseInt(secMatch[1], 10)
  return totalSeconds
}

function formatTotalTime(hops: RouteHop[]): string {
  const totalSec = hops.reduce((s, h) => s + (h.estimatedTime ? parseSeconds(h.estimatedTime) : 0), 0)
  if (totalSec === 0) return ''
  if (totalSec < 60) return `~${totalSec}s`
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return secs > 0 ? `~${mins}min ${secs}s` : `~${mins}min`
}

// ──────────────────────────────────────────────
// COMPACT MODE
// ──────────────────────────────────────────────
interface CompactModeProps {
  hops: RouteHop[]
  canToggle: boolean
  onToggle?: () => void
}

function CompactMode({ hops, canToggle, onToggle }: CompactModeProps) {
  // Decide whether to truncate (more than 3 hops)
  const shouldTruncate = hops.length > 3

  if (shouldTruncate) {
    const first = hops[0]
    const last = hops[hops.length - 1]
    return (
      <button
        type="button"
        onClick={canToggle ? onToggle : undefined}
        className={`flex items-center gap-1.5 flex-wrap ${canToggle ? 'cursor-pointer hover:opacity-80' : ''}`}
      >
        <span className="font-heading font-semibold text-sm text-suwappu-text">{first.fromToken}</span>
        {first.fromChain && <ChainBadge chainId={first.fromChain} size="sm" />}
        <ArrowRight className="w-3.5 h-3.5 text-suwappu-text-secondary" />
        <span className="text-xs text-suwappu-text-secondary bg-suwappu-sakura-100/50 rounded-suwappu-pill px-2 py-0.5">
          via {hops.length} hops
        </span>
        <ArrowRight className="w-3.5 h-3.5 text-suwappu-text-secondary" />
        <span className="font-heading font-semibold text-sm text-suwappu-text">{last.toToken}</span>
        {last.toChain && <ChainBadge chainId={last.toChain} size="sm" />}
        {canToggle && (
          <ChevronDown className="w-3.5 h-3.5 text-suwappu-text-secondary ml-0.5" />
        )}
      </button>
    )
  }

  // Build the inline chain: token [chain?] --provider--> token [chain?] --provider--> ...
  const elements: React.ReactNode[] = []
  let prevChain: string | null = null

  hops.forEach((hop, i) => {
    // From token + chain badge (if chain changed or first hop)
    if (i === 0) {
      elements.push(
        <span key={`ft-${i}`} className="font-heading font-semibold text-sm text-suwappu-text">
          {hop.fromToken}
        </span>
      )
      elements.push(<ChainBadge key={`fc-${i}`} chainId={hop.fromChain} size="sm" />)
      prevChain = hop.fromChain
    }

    // Arrow with provider pill
    elements.push(
      <ArrowRight key={`ar-${i}`} className="w-3.5 h-3.5 text-suwappu-text-secondary shrink-0" />
    )
    elements.push(
      <span
        key={`prov-${i}`}
        className={`text-xs font-medium px-1.5 py-0.5 rounded-suwappu-pill shrink-0 ${
          hop.type === 'bridge'
            ? 'bg-purple-500/10 text-purple-600'
            : 'bg-suwappu-sakura-100/50 text-suwappu-text-secondary'
        }`}
      >
        {hop.provider}
      </span>
    )
    elements.push(
      <ArrowRight key={`ar2-${i}`} className="w-3.5 h-3.5 text-suwappu-text-secondary shrink-0" />
    )

    // To token
    elements.push(
      <span key={`tt-${i}`} className="font-heading font-semibold text-sm text-suwappu-text">
        {hop.toToken}
      </span>
    )

    // Chain badge if chain changed
    if (hop.toChain !== prevChain) {
      elements.push(<ChainBadge key={`tc-${i}`} chainId={hop.toChain} size="sm" />)
    }
    prevChain = hop.toChain
  })

  return (
    <button
      type="button"
      onClick={canToggle ? onToggle : undefined}
      className={`flex items-center gap-1.5 flex-wrap ${canToggle ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      {elements}
      {canToggle && (
        <ChevronDown className="w-3.5 h-3.5 text-suwappu-text-secondary ml-0.5" />
      )}
    </button>
  )
}

// ──────────────────────────────────────────────
// EXPANDED MODE — Vertical timeline
// ──────────────────────────────────────────────
interface ExpandedModeProps {
  hops: RouteHop[]
  canToggle: boolean
  onToggle?: () => void
}

function ExpandedMode({ hops, canToggle, onToggle }: ExpandedModeProps) {
  const totalFees = computeTotalFees(hops)
  const totalTime = formatTotalTime(hops)

  return (
    <div className="flex flex-col">
      {hops.map((hop, i) => (
        <React.Fragment key={i}>
          {/* FROM node (only render for first hop; subsequent use previous "to") */}
          {i === 0 && (
            <div className="flex items-center gap-3">
              <TokenCircle symbol={hop.fromToken} />
              <div className="flex flex-col">
                <span className="font-heading font-semibold text-sm text-suwappu-text">
                  {hop.fromToken}
                </span>
                <ChainBadge chainId={hop.fromChain} size="sm" showLabel />
              </div>
            </div>
          )}

          {/* Connector line + provider info */}
          <div className="flex ml-4">
            {/* Vertical line */}
            <div
              className={`border-l-2 ${
                hop.type === 'bridge' ? 'border-dashed border-purple-300' : 'border-suwappu-sakura-200/25'
              }`}
            >
              <div className="py-3 pl-4 flex flex-col gap-1">
                {/* Provider row */}
                <div className="flex items-center gap-2">
                  <ProviderLogo provider={hop.provider} size="sm" />
                  <span className="text-sm font-medium text-suwappu-text">
                    {hop.poolInfo ?? hop.provider}
                  </span>
                  {hop.type === 'bridge' && (
                    <span className="inline-flex items-center gap-0.5 text-xs text-purple-500 font-medium">
                      <BridgeIcon className="w-3 h-3" />
                      bridge
                    </span>
                  )}
                </div>
                {/* Details row */}
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={
                      hop.type === 'bridge' ? 'text-purple-500' : 'text-suwappu-text-secondary'
                    }
                  >
                    {hop.type}
                  </span>
                  {hop.estimatedTime && (
                    <span className="text-suwappu-text-secondary">{hop.estimatedTime}</span>
                  )}
                  {hop.fee != null && (
                    <span className="text-suwappu-text-secondary">
                      ${hop.fee.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* TO node */}
          <div className="flex items-center gap-3">
            <TokenCircle symbol={hop.toToken} />
            <div className="flex flex-col">
              <span className="font-heading font-semibold text-sm text-suwappu-text">
                {hop.toToken}
              </span>
              <ChainBadge chainId={hop.toChain} size="sm" showLabel />
            </div>
          </div>
        </React.Fragment>
      ))}

      {/* Fee summary */}
      <div className="mt-3 pt-3 border-t border-suwappu-sakura-100/30 flex items-center justify-between">
        <span className="text-xs text-suwappu-text-secondary">
          Total: ${totalFees.toFixed(2)} fees
          {totalTime && <> | {totalTime}</>}
        </span>
        {canToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="text-xs text-suwappu-magenta font-medium hover:underline"
          >
            Collapse
          </button>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// MAIN COMPONENT
// ──────────────────────────────────────────────
export const SwapRouteVisualizer = React.memo(function SwapRouteVisualizer({
  hops,
  mode: controlledMode,
  onToggleMode,
  className = '',
}: SwapRouteVisualizerProps) {
  const [internalMode, setInternalMode] = useState<'compact' | 'expanded'>('compact')

  const mode = controlledMode ?? internalMode

  const handleToggle = useMemo(() => {
    if (onToggleMode) return onToggleMode
    return () => setInternalMode((prev) => (prev === 'compact' ? 'expanded' : 'compact'))
  }, [onToggleMode])

  const canToggle = !!onToggleMode || controlledMode === undefined

  if (hops.length === 0) return null

  return (
    <div className={`${className}`}>
      {mode === 'compact' ? (
        <CompactMode hops={hops} canToggle={canToggle} onToggle={handleToggle} />
      ) : (
        <ExpandedMode hops={hops} canToggle={canToggle} onToggle={handleToggle} />
      )}
    </div>
  )
})

export default SwapRouteVisualizer
