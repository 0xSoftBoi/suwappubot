import React from 'react'
import { ImpactIndicator } from './ImpactIndicator'
import type { SwapQuote, SwapToken } from '../../types/swap'
import type { SimulationResult } from '../../types/simulation'

export interface TransactionSimulationProps {
  quote: SwapQuote
  fromToken: SwapToken
  toToken: SwapToken
  simulation?: SimulationResult | null
  isLoading: boolean
  onConfirm: () => void
  onCancel: () => void
  isExecuting?: boolean
}

// ── Helpers ────────────────────────────────────────────

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTokenAmount(value: string): string {
  const num = parseFloat(value)
  if (isNaN(num)) return value
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  if (num < 1) return num.toPrecision(4)
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 })
}

function getPriceImpactLabel(impact: number): string {
  if (impact < 1) return 'Low Impact'
  if (impact < 3) return 'Moderate Impact'
  if (impact < 5) return 'High Impact'
  return 'Very High Impact'
}

function getPriceImpactColor(impact: number): string {
  if (impact < 1) return 'bg-impact-negligible'
  if (impact < 3) return 'bg-impact-medium'
  if (impact < 5) return 'bg-impact-high'
  return 'bg-impact-severe'
}

function getPriceImpactTextColor(impact: number): string {
  if (impact < 1) return 'text-impact-negligible'
  if (impact < 3) return 'text-impact-medium'
  if (impact < 5) return 'text-impact-high'
  return 'text-impact-severe'
}

function getWarningStyles(severity: 'low' | 'medium' | 'high') {
  switch (severity) {
    case 'low':
      return {
        container: 'bg-blue-50 border-blue-200',
        text: 'text-blue-800',
        icon: '\u{2139}\uFE0F',
      }
    case 'medium':
      return {
        container: 'bg-yellow-50 border-yellow-200',
        text: 'text-yellow-800',
        icon: '\u26A0\uFE0F',
      }
    case 'high':
      return {
        container: 'bg-red-50 border-red-200',
        text: 'text-red-800',
        icon: '\u{1F534}',
      }
  }
}

// ── Sub-components ─────────────────────────────────────

function TokenLogo({ token, size = 'md' }: { token: SwapToken; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-7 h-7' : 'w-10 h-10'
  const textSize = size === 'sm' ? 'text-[9px]' : 'text-xs'

  if (token.logoUrl) {
    return (
      <img
        src={token.logoUrl}
        alt={token.symbol}
        className={`${sizeClass} rounded-full object-cover`}
      />
    )
  }

  return (
    <div className={`${sizeClass} rounded-full bg-suwappu-gradient flex items-center justify-center`}>
      <span className={`text-white font-bold ${textSize}`}>
        {token.symbol.slice(0, 2).toUpperCase()}
      </span>
    </div>
  )
}

function BalanceChangesSection({
  simulation,
  fromToken,
  toToken,
  quote,
}: {
  simulation: SimulationResult
  fromToken: SwapToken
  toToken: SwapToken
  quote: SwapQuote
}) {
  const outChange = simulation.balanceChanges.find(c => c.direction === 'out')
  const inChange = simulation.balanceChanges.find(c => c.direction === 'in')
  const netUsd = (inChange?.amountUsd ?? 0) - (outChange?.amountUsd ?? 0) - simulation.gasEstimate.amountUsd

  return (
    <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1">
      <h3 className="font-heading font-semibold text-xs text-suwappu-text-secondary uppercase tracking-wider mb-3">
        Balance Changes
      </h3>

      {/* You Pay */}
      <div className="flex items-center justify-between py-2.5">
        <div className="flex items-center gap-3">
          <TokenLogo token={fromToken} />
          <div>
            <p className="text-sm font-heading font-semibold text-suwappu-text">You Pay</p>
            <p className="text-xs text-suwappu-text-secondary">{fromToken.symbol}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-heading font-bold text-red-500">
            -{formatTokenAmount(outChange?.amount ?? quote.fromAmount)}
          </p>
          <p className="text-xs text-red-400">
            -{formatUsd(outChange?.amountUsd ?? quote.fromAmountUsd)}
          </p>
        </div>
      </div>

      <div className="border-t border-suwappu-sakura-100/30" />

      {/* You Receive */}
      <div className="flex items-center justify-between py-2.5">
        <div className="flex items-center gap-3">
          <TokenLogo token={toToken} />
          <div>
            <p className="text-sm font-heading font-semibold text-suwappu-text">You Receive</p>
            <p className="text-xs text-suwappu-text-secondary">{toToken.symbol}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-heading font-bold text-green-500">
            +{formatTokenAmount(inChange?.amount ?? quote.toAmount)}
          </p>
          <p className="text-xs text-green-400">
            +{formatUsd(inChange?.amountUsd ?? quote.toAmountUsd)}
          </p>
        </div>
      </div>

      {/* Net USD Impact */}
      <div className="border-t border-suwappu-sakura-100/30 pt-2 mt-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-suwappu-text-secondary">Net cost (incl. gas)</span>
          <span className={`text-xs font-semibold ${netUsd >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {netUsd >= 0 ? '+' : ''}{formatUsd(netUsd)}
          </span>
        </div>
      </div>
    </div>
  )
}

function PriceImpactSection({ priceImpact }: { priceImpact: number }) {
  const label = getPriceImpactLabel(priceImpact)
  const barColor = getPriceImpactColor(priceImpact)
  const textColor = getPriceImpactTextColor(priceImpact)
  // Normalize: 0% = 0 width, 10% = full width, capped at 100
  const barWidth = Math.min((priceImpact / 10) * 100, 100)

  return (
    <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-heading font-semibold text-xs text-suwappu-text-secondary uppercase tracking-wider">
          Price Impact
        </h3>
        <ImpactIndicator value={priceImpact} format="percent" variant="badge" size="sm" />
      </div>

      {/* Gauge bar */}
      <div className="relative h-2 rounded-full bg-suwappu-sakura-200/20 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500 ease-out`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <p className={`text-xs font-medium ${textColor}`}>{label}</p>
    </div>
  )
}

function GasEstimateSection({
  simulation,
  quote,
}: {
  simulation: SimulationResult
  quote: SwapQuote
}) {
  return (
    <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-suwappu-sakura-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-heading font-semibold text-suwappu-text">Gas Estimate</p>
            <p className="text-xs text-suwappu-text-secondary">{simulation.gasEstimate.network}</p>
          </div>
        </div>
        <span className="text-sm font-heading font-bold text-suwappu-text">
          ~{formatUsd(simulation.gasEstimate.amountUsd || quote.gasUsd)}
        </span>
      </div>
    </div>
  )
}

function RouteVisualizationSection({ simulation }: { simulation: SimulationResult }) {
  if (simulation.route.length === 0) return null

  return (
    <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1">
      <h3 className="font-heading font-semibold text-xs text-suwappu-text-secondary uppercase tracking-wider mb-3">
        Route
      </h3>

      <div className="flex items-center gap-1.5 flex-wrap">
        {simulation.route.map((step, i) => (
          <React.Fragment key={i}>
            {/* From token (only first step) */}
            {i === 0 && (
              <span className="inline-flex items-center gap-1 bg-suwappu-sakura-50 rounded-full px-2.5 py-1">
                <span className="w-4 h-4 rounded-full bg-suwappu-gradient flex items-center justify-center">
                  <span className="text-white text-[7px] font-bold">{step.from.slice(0, 2)}</span>
                </span>
                <span className="text-xs font-heading font-semibold text-suwappu-text">{step.from}</span>
              </span>
            )}

            {/* Arrow */}
            <svg className="w-4 h-4 text-suwappu-text-secondary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>

            {/* DEX pill */}
            <span className="inline-flex items-center bg-suwappu-sakura-100/50 rounded-full px-2 py-0.5">
              <span className="text-[10px] font-medium text-suwappu-text-secondary">{step.dex}</span>
              {step.percentage && (
                <span className="text-[10px] text-suwappu-text-muted ml-1">({step.percentage}%)</span>
              )}
            </span>

            {/* Arrow */}
            <svg className="w-4 h-4 text-suwappu-text-secondary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>

            {/* To token */}
            <span className="inline-flex items-center gap-1 bg-suwappu-sakura-50 rounded-full px-2.5 py-1">
              <span className="w-4 h-4 rounded-full bg-suwappu-gradient flex items-center justify-center">
                <span className="text-white text-[7px] font-bold">{step.to.slice(0, 2)}</span>
              </span>
              <span className="text-xs font-heading font-semibold text-suwappu-text">{step.to}</span>
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function WarningsSection({ warnings }: { warnings: SimulationResult['warnings'] }) {
  if (warnings.length === 0) return null

  return (
    <div className="space-y-2">
      {warnings.map((warning, i) => {
        const styles = getWarningStyles(warning.severity)
        return (
          <div
            key={i}
            className={`rounded-suwappu-lg border px-3 py-2.5 ${styles.container}`}
          >
            <div className="flex items-start gap-2">
              <span className="text-sm leading-none mt-0.5" aria-hidden="true">{styles.icon}</span>
              <p className={`text-xs font-medium ${styles.text}`}>{warning.message}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TransactionDetailsSection({ quote }: { quote: SwapQuote }) {
  const rows = [
    {
      label: 'Exchange Rate',
      value: `1 ${quote.fromToken?.symbol ?? '?'} = ${quote.exchangeRate.toFixed(4)} ${quote.toToken?.symbol ?? '?'}`,
    },
    {
      label: 'Min. Received',
      value: `${formatTokenAmount(quote.minReceived)} ${quote.toToken?.symbol ?? ''}`,
    },
    {
      label: 'Slippage',
      value: `${quote.slippage}%`,
    },
  ]

  return (
    <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-xs text-suwappu-text-secondary">{row.label}</span>
            <span className="text-xs font-medium text-suwappu-text">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 animate-pulse">
          <div className="h-3 w-24 bg-suwappu-sakura-200/30 rounded mb-3" />
          <div className="h-10 bg-suwappu-sakura-200/20 rounded" />
        </div>
      ))}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────

export const TransactionSimulation = React.memo(function TransactionSimulation({
  quote,
  fromToken,
  toToken,
  simulation,
  isLoading,
  onConfirm,
  onCancel,
  isExecuting = false,
}: TransactionSimulationProps) {
  if (isLoading && !simulation) {
    return (
      <div className="space-y-3 pb-4">
        <LoadingState />
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-3 bg-white text-suwappu-text-secondary font-heading font-bold text-sm rounded-suwappu-pill border border-suwappu-sakura-mid"
          >
            Cancel
          </button>
          <button
            disabled
            className="px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button opacity-50 cursor-not-allowed"
          >
            Simulating...
          </button>
        </div>
      </div>
    )
  }

  const hasHighRisk = simulation?.warnings.some(w => w.severity === 'high') ?? false

  return (
    <div className="space-y-3 pb-4">
      {/* Balance Changes */}
      {simulation && (
        <BalanceChangesSection
          simulation={simulation}
          fromToken={fromToken}
          toToken={toToken}
          quote={quote}
        />
      )}

      {/* Price Impact */}
      <PriceImpactSection priceImpact={simulation?.priceImpact ?? quote.priceImpact} />

      {/* Gas Estimate */}
      {simulation && (
        <GasEstimateSection simulation={simulation} quote={quote} />
      )}

      {/* Route Visualization */}
      {simulation && (
        <RouteVisualizationSection simulation={simulation} />
      )}

      {/* Transaction Details */}
      <TransactionDetailsSection quote={quote} />

      {/* Risk Warnings */}
      {simulation && <WarningsSection warnings={simulation.warnings} />}

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button
          onClick={onCancel}
          disabled={isExecuting}
          className="px-4 py-3 bg-white text-suwappu-text-secondary font-heading font-bold text-sm rounded-suwappu-pill border border-suwappu-sakura-mid disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={isExecuting}
          className={`px-4 py-3 text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button disabled:opacity-50 disabled:cursor-not-allowed ${
            hasHighRisk
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-suwappu-gradient'
          }`}
        >
          {isExecuting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Executing...
            </span>
          ) : hasHighRisk ? (
            'Swap Anyway'
          ) : (
            'Confirm Swap'
          )}
        </button>
      </div>
    </div>
  )
})

// ── Compact Variant (for QuickSwap) ────────────────────

export interface CompactSimulationProps {
  quote: SwapQuote
  fromToken: SwapToken
  toToken: SwapToken
  simulation?: SimulationResult | null
  isLoading: boolean
}

export const CompactSimulation = React.memo(function CompactSimulation({
  quote,
  fromToken,
  toToken,
  simulation,
  isLoading,
}: CompactSimulationProps) {
  if (isLoading && !simulation) {
    return (
      <div className="rounded-xl bg-suwappu-sakura-50 p-3 animate-pulse">
        <div className="h-3 w-20 bg-suwappu-sakura-200/30 rounded mb-2" />
        <div className="h-8 bg-suwappu-sakura-200/20 rounded" />
      </div>
    )
  }

  if (!simulation) return null

  const outChange = simulation.balanceChanges.find(c => c.direction === 'out')
  const inChange = simulation.balanceChanges.find(c => c.direction === 'in')
  const hasWarnings = simulation.warnings.length > 0
  const highWarnings = simulation.warnings.filter(w => w.severity === 'high' || w.severity === 'medium')

  return (
    <div className="rounded-xl bg-suwappu-sakura-50 border border-suwappu-sakura-mid/20 p-3 space-y-2">
      {/* Header */}
      <p className="text-[10px] font-heading font-semibold text-suwappu-text-secondary uppercase tracking-wider">
        Preview
      </p>

      {/* Balance changes (compact) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TokenLogo token={fromToken} size="sm" />
          <span className="text-xs font-medium text-red-500">
            -{formatTokenAmount(outChange?.amount ?? quote.fromAmount)}
          </span>
        </div>
        <svg className="w-3.5 h-3.5 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-green-500">
            +{formatTokenAmount(inChange?.amount ?? quote.toAmount)}
          </span>
          <TokenLogo token={toToken} size="sm" />
        </div>
      </div>

      {/* Price impact + gas (compact row) */}
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1">
          <span className="text-suwappu-text-secondary">Impact:</span>
          <ImpactIndicator value={simulation.priceImpact} format="percent" variant="inline" size="sm" />
        </div>
        <span className="text-suwappu-text-secondary">
          Gas: ~{formatUsd(simulation.gasEstimate.amountUsd || quote.gasUsd)}
        </span>
      </div>

      {/* Warnings (compact - only show high/medium) */}
      {hasWarnings && highWarnings.length > 0 && (
        <div className="space-y-1">
          {highWarnings.slice(0, 2).map((w, i) => {
            const styles = getWarningStyles(w.severity)
            return (
              <div key={i} className={`rounded-lg border px-2 py-1.5 ${styles.container}`}>
                <p className={`text-[10px] ${styles.text}`}>
                  <span aria-hidden="true">{styles.icon}</span> {w.message}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
