import React from 'react'

export interface ImpactIndicatorProps {
  value: number
  format?: 'percent' | 'usd' | 'score'
  variant?: 'badge' | 'inline' | 'dot' | 'meter'
  size?: 'sm' | 'md' | 'lg'
  thresholds?: { negligible: number; low: number; medium: number; high: number }
  className?: string
}

type Severity = 'negligible' | 'low' | 'medium' | 'high' | 'severe'

interface SeverityConfig {
  label: string
  textClass: string
  bgClass: string
  dotClass: string
}

const SEVERITY_MAP: Record<Severity, SeverityConfig> = {
  negligible: {
    label: 'Negligible',
    textClass: 'text-impact-negligible',
    bgClass: 'bg-impact-negligible/15',
    dotClass: 'bg-impact-negligible',
  },
  low: {
    label: 'Low',
    textClass: 'text-impact-low',
    bgClass: 'bg-impact-low/15',
    dotClass: 'bg-impact-low',
  },
  medium: {
    label: 'Moderate',
    textClass: 'text-impact-medium',
    bgClass: 'bg-impact-medium/15',
    dotClass: 'bg-impact-medium',
  },
  high: {
    label: 'High',
    textClass: 'text-impact-high',
    bgClass: 'bg-impact-high/15',
    dotClass: 'bg-impact-high',
  },
  severe: {
    label: 'Severe',
    textClass: 'text-impact-severe',
    bgClass: 'bg-impact-severe/15',
    dotClass: 'bg-impact-severe',
  },
}

const DEFAULT_THRESHOLDS = {
  negligible: 0.1,
  low: 0.5,
  medium: 2.0,
  high: 5.0,
}

const SIZE_CONFIG = {
  sm: { text: 'text-xs', dot: 'w-1.5 h-1.5', badge: 'px-1.5 py-0.5 text-xs', meter: 'h-1' },
  md: { text: 'text-sm', dot: 'w-2 h-2', badge: 'px-2 py-1 text-sm', meter: 'h-2' },
  lg: { text: 'text-base', dot: 'w-2.5 h-2.5', badge: 'px-3 py-1.5 text-base', meter: 'h-3' },
} as const

function getSeverity(value: number, thresholds: typeof DEFAULT_THRESHOLDS): Severity {
  if (value < thresholds.negligible) return 'negligible'
  if (value < thresholds.low) return 'low'
  if (value < thresholds.medium) return 'medium'
  if (value < thresholds.high) return 'high'
  return 'severe'
}

function formatValue(value: number, format: 'percent' | 'usd' | 'score'): string {
  switch (format) {
    case 'percent':
      return `${value}%`
    case 'usd':
      return `$${value.toFixed(2)}`
    case 'score':
      return `${Math.round(value)}/100`
  }
}

function getMeterPosition(value: number, thresholds: typeof DEFAULT_THRESHOLDS): number {
  const max = thresholds.high * 1.5
  return Math.min((value / max) * 100, 100)
}

function BadgeVariant({
  formatted,
  config,
  sizeConfig,
  ariaLabel,
  className,
}: {
  formatted: string
  config: SeverityConfig
  sizeConfig: (typeof SIZE_CONFIG)[keyof typeof SIZE_CONFIG]
  ariaLabel: string
  className: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-suwappu-pill font-medium ${config.bgClass} ${config.textClass} ${sizeConfig.badge} ${className}`}
      aria-label={ariaLabel}
      role="status"
    >
      <span>{formatted}</span>
      <span>{config.label}</span>
    </span>
  )
}

function InlineVariant({
  formatted,
  config,
  sizeConfig,
  ariaLabel,
  className,
}: {
  formatted: string
  config: SeverityConfig
  sizeConfig: (typeof SIZE_CONFIG)[keyof typeof SIZE_CONFIG]
  ariaLabel: string
  className: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium ${config.textClass} ${sizeConfig.text} ${className}`}
      aria-label={ariaLabel}
      role="status"
    >
      <span>{formatted}</span>
      <span className="sr-only">({config.label})</span>
    </span>
  )
}

function DotVariant({
  formatted,
  config,
  sizeConfig,
  ariaLabel,
  className,
}: {
  formatted: string
  config: SeverityConfig
  sizeConfig: (typeof SIZE_CONFIG)[keyof typeof SIZE_CONFIG]
  ariaLabel: string
  className: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${sizeConfig.text} ${className}`}
      aria-label={ariaLabel}
      role="status"
    >
      <span className={`${sizeConfig.dot} rounded-suwappu-pill ${config.dotClass} shrink-0`} aria-hidden="true" />
      <span className={config.textClass}>{formatted}</span>
      <span className="sr-only">({config.label})</span>
    </span>
  )
}

function MeterVariant({
  formatted,
  value,
  config,
  sizeConfig,
  thresholds,
  ariaLabel,
  className,
}: {
  formatted: string
  value: number
  config: SeverityConfig
  sizeConfig: (typeof SIZE_CONFIG)[keyof typeof SIZE_CONFIG]
  thresholds: typeof DEFAULT_THRESHOLDS
  ariaLabel: string
  className: string
}) {
  const position = getMeterPosition(value, thresholds)
  const max = thresholds.high * 1.5

  // Segment widths as percentages of the total bar
  const segments = [
    { width: (thresholds.negligible / max) * 100, colorClass: 'bg-impact-negligible' },
    { width: ((thresholds.low - thresholds.negligible) / max) * 100, colorClass: 'bg-impact-low' },
    { width: ((thresholds.medium - thresholds.low) / max) * 100, colorClass: 'bg-impact-medium' },
    { width: ((thresholds.high - thresholds.medium) / max) * 100, colorClass: 'bg-impact-high' },
    { width: ((max - thresholds.high) / max) * 100, colorClass: 'bg-impact-severe' },
  ]

  return (
    <div
      className={`flex flex-col gap-1 ${className}`}
      aria-label={ariaLabel}
      role="status"
    >
      <div className="flex items-center justify-between">
        <span className={`font-medium ${config.textClass} ${sizeConfig.text}`}>
          {formatted}
        </span>
        <span className={`font-medium ${config.textClass} ${sizeConfig.text}`}>
          {config.label}
        </span>
      </div>
      <div className="relative">
        <div className={`flex ${sizeConfig.meter} rounded-suwappu-pill overflow-hidden`}>
          {segments.map((segment, i) => (
            <div
              key={i}
              className={`${segment.colorClass}`}
              style={{ width: `${segment.width}%` }}
            />
          ))}
        </div>
        <div
          className="absolute top-0 -translate-x-1/2"
          style={{ left: `${position}%` }}
        >
          <div
            className={`w-0 h-0 border-l-[4px] border-r-[4px] border-t-[6px] border-l-transparent border-r-transparent border-t-current ${config.textClass}`}
          />
        </div>
      </div>
    </div>
  )
}

export const ImpactIndicator = React.memo(function ImpactIndicator({
  value,
  format = 'percent',
  variant = 'badge',
  size = 'md',
  thresholds = DEFAULT_THRESHOLDS,
  className = '',
}: ImpactIndicatorProps) {
  const severity = getSeverity(value, thresholds)
  const config = SEVERITY_MAP[severity]
  const sizeConfig = SIZE_CONFIG[size]
  const formatted = formatValue(value, format)

  const formatLabel = format === 'percent' ? 'Price impact' : format === 'usd' ? 'Fee' : 'Score'
  const ariaLabel = `${formatLabel}: ${formatted}, ${config.label.toLowerCase()}`

  switch (variant) {
    case 'badge':
      return (
        <BadgeVariant
          formatted={formatted}
          config={config}
          sizeConfig={sizeConfig}
          ariaLabel={ariaLabel}
          className={className}
        />
      )
    case 'inline':
      return (
        <InlineVariant
          formatted={formatted}
          config={config}
          sizeConfig={sizeConfig}
          ariaLabel={ariaLabel}
          className={className}
        />
      )
    case 'dot':
      return (
        <DotVariant
          formatted={formatted}
          config={config}
          sizeConfig={sizeConfig}
          ariaLabel={ariaLabel}
          className={className}
        />
      )
    case 'meter':
      return (
        <MeterVariant
          formatted={formatted}
          value={value}
          config={config}
          sizeConfig={sizeConfig}
          thresholds={thresholds}
          ariaLabel={ariaLabel}
          className={className}
        />
      )
  }
})
