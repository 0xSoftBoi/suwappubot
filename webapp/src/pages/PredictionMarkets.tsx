import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { MarketCard, MarketSearch } from '../components/prediction'
import { SkeletonCard, RegionRestrictedNotice } from '../components/ui'
import { usePredictionMarkets } from '../hooks/usePredictionMarkets'
import { usePredictionPositions } from '../hooks/usePredictionPositions'
import { isRegionRestrictedError } from '../lib/api'

function formatUsd(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v)
}

export function PredictionMarkets() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [category, setCategory] = useState<string | undefined>()

  const params = useMemo(() => ({
    query: searchQuery || undefined,
    category: category || undefined,
    limit: 30,
  }), [searchQuery, category])

  const { data: markets, isLoading, error } = usePredictionMarkets(params)
  const { data: positions } = usePredictionPositions()
  const regionRestricted = isRegionRestrictedError(error)

  const totalPositionValue = positions?.reduce((sum, p) => sum + p.currentValue, 0) ?? 0

  return (
    <AppLayout
      header={<AppHeader title="Prediction Markets" showBack onBack={() => navigate(-1)} />}
      activeNav="earn"
    >
      <div className="p-3 pb-20 space-y-3">
        <MarketSearch
          onSearch={setSearchQuery}
          onCategoryChange={setCategory}
          activeCategory={category}
        />

        {regionRestricted && <RegionRestrictedNotice feature="Prediction markets" />}

        {/* Active positions banner */}
        {!regionRestricted && positions && positions.length > 0 && (
          <button
            onClick={() => {/* scroll to positions or navigate */}}
            className="w-full bg-gradient-suwappu rounded-suwappu-xl p-3 text-white text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Your Positions</p>
                <p className="text-2xl font-heading font-bold">
                  {positions.length} market{positions.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs opacity-80">Total value: {formatUsd(totalPositionValue)}</p>
              </div>
              <span className="text-4xl">📊</span>
            </div>
          </button>
        )}

        {/* Loading state */}
        {!regionRestricted && isLoading && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={5} variant="token" />
          </div>
        )}

        {/* Market cards */}
        {!regionRestricted && !isLoading && markets && markets.length > 0 && (
          <div className="space-y-3">
            {markets.map((market) => (
              <MarketCard key={market.conditionId} market={market} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!regionRestricted && !isLoading && (!markets || markets.length === 0) && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <span className="text-4xl block mb-2">🔮</span>
            <p className="font-heading font-semibold text-suwappu-text mb-1">
              No markets found
            </p>
            <p className="text-xs text-suwappu-text-secondary">
              {searchQuery || category
                ? 'Try a different search or category'
                : 'Check back later for prediction markets'}
            </p>
          </div>
        )}

        {/* Info card */}
        {!regionRestricted && (
          <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
            <p className="text-xs text-suwappu-text-secondary">
              Powered by Polymarket. Prediction markets let you trade on the
              outcome of real-world events. Prices reflect the market's estimated
              probability of each outcome.
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
