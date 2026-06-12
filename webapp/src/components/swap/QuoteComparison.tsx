import React, { useState, useMemo } from 'react'
import { ProviderLogo } from '../swap/ProviderLogo'
import { ImpactIndicator } from '../swap/ImpactIndicator'
import { AnimatedNumber } from '../swap/AnimatedNumber'

export interface SwapQuoteResult {
  id: string
  provider: string
  receiveAmount: number
  receiveToken: string
  rate: number
  priceImpact: number
  gasCostUsd: number
  estimatedTime: string
  route: string
  bridgeFee?: number
  badges: ('best-price' | 'fastest' | 'lowest-gas')[]
}

export interface QuoteComparisonProps {
  quotes: SwapQuoteResult[]
  isLoading: boolean
  selectedQuoteId?: string
  onSelect: (quoteId: string) => void
  fromTokenSymbol: string
  toTokenSymbol: string
  className?: string
}

const BADGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  'best-price': {
    bg: 'bg-green-500/10',
    text: 'text-green-600',
    label: 'Best Price',
  },
  fastest: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-600',
    label: 'Fastest',
  },
  'lowest-gas': {
    bg: 'bg-purple-500/10',
    text: 'text-purple-600',
    label: 'Lowest Gas',
  },
}

const DEFAULT_VISIBLE_COUNT = 3

function SkeletonCard() {
  return (
    <div className="rounded-suwappu-md bg-white shadow-suwappu-1 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="suwappu-quote-shimmer w-7 h-7 rounded-suwappu-sm bg-suwappu-sakura-200/30" />
        <div className="suwappu-quote-shimmer h-4 w-28 rounded bg-suwappu-sakura-200/30" />
      </div>
      <div className="space-y-2.5">
        <div className="suwappu-quote-shimmer h-3.5 w-48 rounded bg-suwappu-sakura-200/30" />
        <div className="suwappu-quote-shimmer h-3.5 w-40 rounded bg-suwappu-sakura-200/30" />
        <div className="suwappu-quote-shimmer h-3.5 w-36 rounded bg-suwappu-sakura-200/30" />
      </div>
    </div>
  )
}

function QuoteBadge({ type }: { type: string }) {
  const style = BADGE_STYLES[type]
  if (!style) return null
  return (
    <span
      className={`${style.bg} ${style.text} text-xs font-medium rounded-suwappu-pill px-2 py-0.5 whitespace-nowrap`}
    >
      {style.label}
    </span>
  )
}

interface QuoteCardProps {
  quote: SwapQuoteResult
  isSelected: boolean
  isWorse: boolean
  fromTokenSymbol: string
  toTokenSymbol: string
  onSelect: (quoteId: string) => void
  animationDelay: number
}

const QuoteCard = React.memo(function QuoteCard({
  quote,
  isSelected,
  isWorse,
  fromTokenSymbol,
  toTokenSymbol,
  onSelect,
  animationDelay,
}: QuoteCardProps) {
  const cardClass = isSelected
    ? 'ring-2 ring-suwappu-magenta shadow-suwappu-3'
    : 'bg-white shadow-suwappu-1 hover:shadow-suwappu-2'

  return (
    <button
      type="button"
      onClick={() => onSelect(quote.id)}
      className={`
        w-full text-left rounded-suwappu-md p-4 cursor-pointer
        transition-all duration-200 animate-slide-up
        ${cardClass}
        ${isWorse ? 'opacity-60' : ''}
        ${!isSelected ? 'bg-white' : 'bg-white'}
      `.trim()}
      style={{ animationDelay: `${animationDelay}ms` }}
      aria-pressed={isSelected}
    >
      {/* Header: Provider + Badges */}
      <div className="flex items-center justify-between mb-3">
        <ProviderLogo provider={quote.provider} size="md" showName />
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {quote.badges.map((badge) => (
            <QuoteBadge key={badge} type={badge} />
          ))}
        </div>
      </div>

      {/* Details */}
      <div className="space-y-1.5 font-body text-sm">
        {/* Receive amount */}
        <div className="flex items-center justify-between">
          <span className="text-suwappu-text-secondary">You receive:</span>
          <span className="font-medium text-suwappu-text">
            <AnimatedNumber
              value={quote.receiveAmount}
              format="currency"
              decimals={2}
              size="sm"
              colorChange
            />{' '}
            {quote.receiveToken}
          </span>
        </div>

        {/* Rate */}
        <div className="flex items-center justify-between">
          <span className="text-suwappu-text-secondary">Rate:</span>
          <span className="text-suwappu-text">
            1 {fromTokenSymbol} = {quote.rate.toLocaleString('en-US', { maximumFractionDigits: 6 })}{' '}
            {toTokenSymbol}
          </span>
        </div>

        {/* Impact */}
        <div className="flex items-center justify-between">
          <span className="text-suwappu-text-secondary">Impact:</span>
          <ImpactIndicator value={quote.priceImpact} format="percent" variant="dot" size="sm" />
        </div>

        {/* Gas + Time */}
        <div className="flex items-center justify-between">
          <span className="text-suwappu-text-secondary">Gas:</span>
          <span className="text-suwappu-text">
            ${quote.gasCostUsd.toFixed(2)}
            <span className="mx-1.5 text-suwappu-text-secondary">|</span>
            Time: {quote.estimatedTime}
          </span>
        </div>

        {/* Bridge fee (cross-chain) */}
        {quote.bridgeFee != null && (
          <div className="flex items-center justify-between">
            <span className="text-suwappu-text-secondary">Bridge fee:</span>
            <span className="text-suwappu-text">${quote.bridgeFee.toFixed(2)}</span>
          </div>
        )}

        {/* Route */}
        <div className="flex items-center justify-between">
          <span className="text-suwappu-text-secondary">Route:</span>
          <span className="text-suwappu-text text-xs truncate max-w-[60%] text-right">
            {quote.route}
          </span>
        </div>
      </div>
    </button>
  )
})

function NoResultsState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <svg
        className="w-12 h-12 text-suwappu-text-secondary opacity-40 mb-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
        />
      </svg>
      <p className="text-sm font-medium text-suwappu-text-secondary">
        No routes available for this pair
      </p>
    </div>
  )
}

export function QuoteComparison({
  quotes,
  isLoading,
  selectedQuoteId,
  onSelect,
  fromTokenSymbol,
  toTokenSymbol,
  className = '',
}: QuoteComparisonProps) {
  const [expanded, setExpanded] = useState(false)

  // Sort by receiveAmount descending (best first)
  const sortedQuotes = useMemo(() => {
    return [...quotes].sort((a, b) => b.receiveAmount - a.receiveAmount)
  }, [quotes])

  // Best net amount: receiveAmount minus gas approximation
  const bestNetAmount = useMemo(() => {
    if (sortedQuotes.length === 0) return 0
    return Math.max(...sortedQuotes.map((q) => q.receiveAmount - q.gasCostUsd))
  }, [sortedQuotes])

  const visibleQuotes = expanded ? sortedQuotes : sortedQuotes.slice(0, DEFAULT_VISIBLE_COUNT)
  const hiddenCount = sortedQuotes.length - DEFAULT_VISIBLE_COUNT

  // Loading state
  if (isLoading && quotes.length === 0) {
    return (
      <div className={`space-y-3 ${className}`.trim()}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  // No results
  if (!isLoading && quotes.length === 0) {
    return (
      <div className={className}>
        <NoResultsState />
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`.trim()}>
      {visibleQuotes.map((quote, index) => {
        const netAmount = quote.receiveAmount - quote.gasCostUsd
        const isWorse = bestNetAmount > 0 && (bestNetAmount - netAmount) / bestNetAmount > 0.02

        return (
          <QuoteCard
            key={quote.id}
            quote={quote}
            isSelected={selectedQuoteId === quote.id}
            isWorse={isWorse}
            fromTokenSymbol={fromTokenSymbol}
            toTokenSymbol={toTokenSymbol}
            onSelect={onSelect}
            animationDelay={index * 50}
          />
        )
      })}

      {/* Loading shimmer for additional quotes still arriving */}
      {isLoading && quotes.length > 0 && <SkeletonCard />}

      {/* Show more button */}
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full py-2.5 text-sm font-medium text-suwappu-text-secondary hover:text-suwappu-text rounded-suwappu-md border border-suwappu-sakura-200/25 hover:border-suwappu-sakura-300/25 transition-colors"
        >
          Show {hiddenCount} more route{hiddenCount > 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}

export default QuoteComparison
