import { useState } from 'react'
import { AppLayout, AppHeader } from '../components/layout'
import { SkeletonCard } from '../components/ui'
import { usePerpsMarkets } from '../hooks/usePerpsMarkets'
import { useNavigate } from 'react-router-dom'

function formatPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(4)
}

function formatFunding(rate: number): string {
  const pct = rate * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%`
}

export function PerpsMarkets() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const { data: markets, isLoading } = usePerpsMarkets()

  const filtered = markets?.filter((m) =>
    !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.asset.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AppLayout
      header={<AppHeader title="Perpetuals" showBack onBack={() => navigate(-1)} />}
      activeNav="earn"
    >
      <div className="p-3 pb-20 space-y-3">
        {/* Search */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
          <input
            type="text"
            placeholder="Search markets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-suwappu-sakura-light/30 rounded-suwappu-lg px-3 py-2 text-sm outline-none placeholder:text-suwappu-text-secondary"
          />
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={5} variant="token" />
          </div>
        )}

        {/* Market list */}
        {!isLoading && filtered && filtered.length > 0 && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden divide-y divide-suwappu-sakura-light/50">
            {filtered.map((market) => (
              <button
                key={market.name}
                onClick={() => navigate(`/perps/${encodeURIComponent(market.name)}`)}
                className="w-full flex items-center justify-between p-3 hover:bg-suwappu-sakura-light/20 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-suwappu-purple-deep/10 flex items-center justify-center text-sm font-bold text-suwappu-purple-deep">
                    {market.asset.slice(0, 2)}
                  </div>
                  <div>
                    <p className="font-heading font-semibold text-sm text-suwappu-text">{market.name}</p>
                    <p className="text-[10px] text-suwappu-text-secondary">
                      Max {market.maxLeverage}x leverage
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-heading font-semibold text-sm text-suwappu-text">
                    ${formatPrice(market.markPrice)}
                  </p>
                  <p className={`text-[10px] font-medium ${market.fundingRate >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {formatFunding(market.fundingRate)}/h
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && (!filtered || filtered.length === 0) && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <span className="text-4xl block mb-2">📊</span>
            <p className="font-heading font-semibold text-suwappu-text mb-1">No markets found</p>
            <p className="text-xs text-suwappu-text-secondary">
              {search ? 'Try a different search' : 'Check back later'}
            </p>
          </div>
        )}

        {/* Info */}
        <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
          <p className="text-xs text-suwappu-text-secondary">
            Powered by Hyperliquid. Trade perpetual futures with up to 20x
            leverage on major crypto assets.
          </p>
        </div>
      </div>
    </AppLayout>
  )
}
