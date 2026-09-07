import React, { useMemo } from 'react'

export interface SwapImpactGaugeProps {
  overallScore: number
  priceImpact: number
  gasCostUsd: number
  slippageRisk: 'low' | 'medium' | 'high'
  liquidityDepth: 'deep' | 'moderate' | 'shallow'
  estimatedSavings?: number
  previousScore?: number
  variant?: 'full' | 'compact' | 'mini'
  className?: string
}

type ScoreRange = 'excellent' | 'good' | 'fair' | 'poor' | 'bad'

interface ScoreConfig {
  label: string
  textClass: string
  bgClass: string
  strokeClass: string
  recommendation: string
}

const SCORE_RANGES: Record<ScoreRange, ScoreConfig> = {
  excellent: {
    label: 'Excellent',
    textClass: 'text-impact-negligible',
    bgClass: 'bg-impact-negligible',
    strokeClass: 'stroke-impact-negligible',
    recommendation: 'Great swap conditions! Proceed with confidence.',
  },
  good: {
    label: 'Good',
    textClass: 'text-impact-low',
    bgClass: 'bg-impact-low',
    strokeClass: 'stroke-impact-low',
    recommendation: 'Solid swap with reasonable costs. Good to go.',
  },
  fair: {
    label: 'Fair',
    textClass: 'text-impact-medium',
    bgClass: 'bg-impact-medium',
    strokeClass: 'stroke-impact-medium',
    recommendation: 'Consider reducing swap size or waiting for better conditions.',
  },
  poor: {
    label: 'Poor',
    textClass: 'text-impact-high',
    bgClass: 'bg-impact-high',
    strokeClass: 'stroke-impact-high',
    recommendation: 'High impact detected. Try splitting into smaller swaps.',
  },
  bad: {
    label: 'Bad',
    textClass: 'text-impact-severe',
    bgClass: 'bg-impact-severe',
    strokeClass: 'stroke-impact-severe',
    recommendation: 'Swap conditions are unfavorable. Consider waiting or using a different route.',
  },
}

function getScoreRange(score: number): ScoreRange {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'fair'
  if (score >= 20) return 'poor'
  return 'bad'
}

function getSlippageConfig(risk: 'low' | 'medium' | 'high') {
  switch (risk) {
    case 'low':
      return { label: 'Low', value: 25, textClass: 'text-impact-negligible', bgClass: 'bg-impact-negligible' }
    case 'medium':
      return { label: 'Medium', value: 55, textClass: 'text-impact-medium', bgClass: 'bg-impact-medium' }
    case 'high':
      return { label: 'High', value: 85, textClass: 'text-impact-high', bgClass: 'bg-impact-high' }
  }
}

function getLiquidityConfig(depth: 'deep' | 'moderate' | 'shallow') {
  switch (depth) {
    case 'deep':
      return { label: 'Deep', value: 90, textClass: 'text-impact-negligible', bgClass: 'bg-impact-negligible' }
    case 'moderate':
      return { label: 'Moderate', value: 55, textClass: 'text-impact-medium', bgClass: 'bg-impact-medium' }
    case 'shallow':
      return { label: 'Shallow', value: 20, textClass: 'text-impact-severe', bgClass: 'bg-impact-severe' }
  }
}

function getPriceImpactConfig(impact: number) {
  if (impact < 0.1) return { textClass: 'text-impact-negligible', bgClass: 'bg-impact-negligible' }
  if (impact < 0.5) return { textClass: 'text-impact-low', bgClass: 'bg-impact-low' }
  if (impact < 2.0) return { textClass: 'text-impact-medium', bgClass: 'bg-impact-medium' }
  if (impact < 5.0) return { textClass: 'text-impact-high', bgClass: 'bg-impact-high' }
  return { textClass: 'text-impact-severe', bgClass: 'bg-impact-severe' }
}

function getGasCostConfig(cost: number) {
  if (cost < 1) return { textClass: 'text-impact-negligible', bgClass: 'bg-impact-negligible' }
  if (cost < 5) return { textClass: 'text-impact-low', bgClass: 'bg-impact-low' }
  if (cost < 15) return { textClass: 'text-impact-medium', bgClass: 'bg-impact-medium' }
  if (cost < 30) return { textClass: 'text-impact-high', bgClass: 'bg-impact-high' }
  return { textClass: 'text-impact-severe', bgClass: 'bg-impact-severe' }
}

// SVG gauge constants
const GAUGE_SIZE = 200
const GAUGE_CENTER = GAUGE_SIZE / 2
const GAUGE_RADIUS = 80
const GAUGE_STROKE = 12
const GAUGE_CIRCUMFERENCE = Math.PI * GAUGE_RADIUS // semi-circle

function SemiCircularGauge({
  score,
  config,
  size = 'default',
}: {
  score: number
  config: ScoreConfig
  size?: 'default' | 'compact'
}) {
  const clampedScore = Math.max(0, Math.min(100, score))
  const dashOffset = GAUGE_CIRCUMFERENCE - (clampedScore / 100) * GAUGE_CIRCUMFERENCE

  const scale = size === 'compact' ? 0.75 : 1
  const viewWidth = GAUGE_SIZE * scale
  const viewHeight = (GAUGE_SIZE / 2 + 20) * scale

  return (
    <div className="relative flex flex-col items-center">
      <svg
        width={viewWidth}
        height={viewHeight}
        viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE / 2 + 20}`}
        className="overflow-visible"
      >
        {/* Background arc */}
        <path
          d={`M ${GAUGE_CENTER - GAUGE_RADIUS} ${GAUGE_CENTER} A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 0 1 ${GAUGE_CENTER + GAUGE_RADIUS} ${GAUGE_CENTER}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={GAUGE_STROKE}
          strokeLinecap="round"
          className="text-suwappu-sakura-200/30"
        />
        {/* Filled arc */}
        <path
          d={`M ${GAUGE_CENTER - GAUGE_RADIUS} ${GAUGE_CENTER} A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 0 1 ${GAUGE_CENTER + GAUGE_RADIUS} ${GAUGE_CENTER}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={GAUGE_STROKE}
          strokeLinecap="round"
          strokeDasharray={GAUGE_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          className={`${config.strokeClass} transition-all duration-700 ease-out`}
        />
      </svg>
      {/* Score text overlay */}
      <div
        className="absolute flex flex-col items-center"
        style={{ top: size === 'compact' ? '25%' : '30%' }}
      >
        <span
          className={`font-bold tabular-nums transition-colors duration-300 ${config.textClass} ${
            size === 'compact' ? 'text-3xl' : 'text-4xl'
          }`}
        >
          {clampedScore}
        </span>
        <span
          className={`text-xs font-medium transition-colors duration-300 ${config.textClass}`}
        >
          {config.label}
        </span>
      </div>
    </div>
  )
}

function MetricBar({
  label,
  value,
  displayValue,
  textClass,
  bgClass,
}: {
  label: string
  value: number
  displayValue: string
  textClass: string
  bgClass: string
}) {
  const clampedValue = Math.max(0, Math.min(100, value))

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-suwappu-text-secondary">{label}</span>
        <span className={`text-xs font-medium ${textClass}`}>{displayValue}</span>
      </div>
      <div className="h-1.5 rounded-suwappu-pill bg-suwappu-sakura-200/20 overflow-hidden">
        <div
          className={`h-full rounded-suwappu-pill ${bgClass} transition-all duration-500 ease-out`}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    </div>
  )
}

function MiniVariant({
  score,
  config,
  className,
}: {
  score: number
  config: ScoreConfig
  className: string
}) {
  return (
    <div
      className={`inline-flex items-center justify-center w-10 h-10 rounded-suwappu-pill border-2 transition-colors duration-300 ${className}`}
      style={{ borderColor: 'currentColor' }}
      role="status"
      aria-label={`Swap score: ${score}, ${config.label}`}
    >
      <span className={`text-sm font-bold tabular-nums ${config.textClass}`}>
        {score}
      </span>
    </div>
  )
}

export const SwapImpactGauge = React.memo(function SwapImpactGauge({
  overallScore,
  priceImpact,
  gasCostUsd,
  slippageRisk,
  liquidityDepth,
  estimatedSavings,
  previousScore,
  variant = 'full',
  className = '',
}: SwapImpactGaugeProps) {
  const scoreRange = getScoreRange(overallScore)
  const config = SCORE_RANGES[scoreRange]

  const slippageConfig = useMemo(() => getSlippageConfig(slippageRisk), [slippageRisk])
  const liquidityConfig = useMemo(() => getLiquidityConfig(liquidityDepth), [liquidityDepth])
  const priceImpactConfig = useMemo(() => getPriceImpactConfig(priceImpact), [priceImpact])
  const gasCostConfig = useMemo(() => getGasCostConfig(gasCostUsd), [gasCostUsd])

  // Price impact bar: normalize 0-10% range to 0-100
  const priceImpactBarValue = Math.min((priceImpact / 10) * 100, 100)
  // Gas cost bar: normalize $0-50 range to 0-100
  const gasCostBarValue = Math.min((gasCostUsd / 50) * 100, 100)

  const scoreDelta = previousScore !== undefined ? overallScore - previousScore : undefined

  if (variant === 'mini') {
    return (
      <MiniVariant score={overallScore} config={config} className={`${config.textClass} ${className}`} />
    )
  }

  if (variant === 'compact') {
    return (
      <div
        className={`bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 p-4 ${className}`}
        role="status"
        aria-label={`Swap score: ${overallScore}, ${config.label}`}
      >
        <SemiCircularGauge score={overallScore} config={config} size="compact" />
      </div>
    )
  }

  // Full variant
  return (
    <div
      className={`bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 p-5 ${className}`}
      role="status"
      aria-label={`Swap impact analysis: score ${overallScore}, ${config.label}`}
    >
      {/* Gauge */}
      <SemiCircularGauge score={overallScore} config={config} />

      {/* Comparison with previous */}
      {scoreDelta !== undefined && (
        <div className="flex items-center justify-center gap-1 -mt-1 mb-3">
          <span className="text-xs text-suwappu-text-secondary">vs previous:</span>
          <span
            className={`text-xs font-medium ${
              scoreDelta > 0
                ? 'text-impact-negligible'
                : scoreDelta < 0
                  ? 'text-impact-severe'
                  : 'text-suwappu-text-secondary'
            }`}
          >
            {scoreDelta > 0 ? '+' : ''}
            {scoreDelta} pts
          </span>
        </div>
      )}

      {/* Breakdown metrics */}
      <div className="flex flex-col gap-3 mt-2">
        <MetricBar
          label="Price Impact"
          value={priceImpactBarValue}
          displayValue={`${priceImpact}%`}
          textClass={priceImpactConfig.textClass}
          bgClass={priceImpactConfig.bgClass}
        />
        <MetricBar
          label="Gas Cost"
          value={gasCostBarValue}
          displayValue={`$${gasCostUsd.toFixed(2)}`}
          textClass={gasCostConfig.textClass}
          bgClass={gasCostConfig.bgClass}
        />
        <MetricBar
          label="Slippage Risk"
          value={slippageConfig.value}
          displayValue={slippageConfig.label}
          textClass={slippageConfig.textClass}
          bgClass={slippageConfig.bgClass}
        />
        <MetricBar
          label="Liquidity Depth"
          value={liquidityConfig.value}
          displayValue={liquidityConfig.label}
          textClass={liquidityConfig.textClass}
          bgClass={liquidityConfig.bgClass}
        />
      </div>

      {/* Estimated savings */}
      {estimatedSavings !== undefined && (
        <div className="flex items-center justify-between mt-3 px-2 py-1.5 rounded-suwappu-md bg-impact-negligible/10">
          <span className="text-xs text-suwappu-text-secondary">Est. savings vs market</span>
          <span className="text-xs font-semibold text-impact-negligible">
            +${estimatedSavings.toFixed(2)}
          </span>
        </div>
      )}

      {/* Recommendation */}
      <div className="bg-suwappu-sakura-50 rounded-suwappu-md p-3 mt-3">
        <p className={`text-xs font-medium ${config.textClass}`}>{config.recommendation}</p>
      </div>
    </div>
  )
})
