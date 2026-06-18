import { useParams, useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { SkeletonCard } from '../components/ui'
import { usePerpsMarkets } from '../hooks/usePerpsMarkets'

function formatPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(4)
}

function formatFunding(rate: number): string {
  const pct = rate * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%`
}

export function PerpsMarketDetail() {
  const { symbol } = useParams<{ symbol: string }>()
  const navigate = useNavigate()
  const { data: markets, isLoading } = usePerpsMarkets()

  const market = markets?.find((m) => m.name === symbol)

  return (
    <AppLayout
      header={<AppHeader title={symbol || 'Market'} showBack onBack={() => navigate(-1)} />}
      activeNav="earn"
    >
      <div className="p-3 pb-20 space-y-3">
        {isLoading && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={4} variant="token" />
          </div>
        )}

        {!isLoading && !market && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <span className="text-4xl block mb-2">❌</span>
            <p className="font-heading font-semibold text-suwappu-text">Market not found</p>
          </div>
        )}

        {market && (
          <>
            {/* Price header */}
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-suwappu-purple-deep/10 flex items-center justify-center text-lg font-bold text-suwappu-purple-deep">
                  {market.asset.slice(0, 2)}
                </div>
                <div>
                  <h2 className="font-heading font-bold text-lg text-suwappu-text">{market.name}</h2>
                  <p className="text-xs text-suwappu-text-secondary">Perpetual Future</p>
                </div>
              </div>
              <div className="text-center py-4">
                <p className="text-3xl font-heading font-bold text-suwappu-text">
                  ${formatPrice(market.markPrice)}
                </p>
                <p className="text-xs text-suwappu-text-secondary mt-1">Mark Price</p>
              </div>
            </div>

            {/* Market stats */}
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-4">
              <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-3">Market Info</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-suwappu-text-secondary">Asset</span>
                  <span className="text-xs font-medium text-suwappu-text">{market.asset}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-suwappu-text-secondary">Max Leverage</span>
                  <span className="text-xs font-medium text-suwappu-text">{market.maxLeverage}x</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-suwappu-text-secondary">Funding Rate (1h)</span>
                  <span className={`text-xs font-medium ${market.fundingRate >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {formatFunding(market.fundingRate)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-suwappu-text-secondary">Size Decimals</span>
                  <span className="text-xs font-medium text-suwappu-text">{market.szDecimals}</span>
                </div>
              </div>
            </div>

            {/* Trade via bot CTA */}
            <div className="bg-gradient-suwappu rounded-suwappu-xl p-4 text-white text-center">
              <p className="font-heading font-semibold text-sm mb-1">Ready to trade?</p>
              <p className="text-xs opacity-80 mb-3">
                Use the /perps command in the Telegram bot to open positions.
              </p>
              <button
                onClick={() => {
                  if (window.Telegram?.WebApp) {
                    window.Telegram.WebApp.close()
                  }
                }}
                className="bg-white/20 backdrop-blur-sm rounded-suwappu-lg px-4 py-2 text-sm font-heading font-semibold"
              >
                Open Bot
              </button>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}
