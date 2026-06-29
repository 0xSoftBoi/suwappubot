import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { SkeletonCard } from '../components/ui'
import { api } from '../lib/api'
import type { StockEntry } from '../lib/api'

function confidenceLabel(score: number): { text: string; color: string } {
  if (score >= 0.9) return { text: 'High', color: 'text-green-600 bg-green-50' }
  if (score >= 0.7) return { text: 'Medium', color: 'text-yellow-600 bg-yellow-50' }
  return { text: 'Low', color: 'text-suwappu-text-secondary bg-suwappu-sakura-light' }
}

interface StockRowProps {
  stock: StockEntry
  onTrade: (stock: StockEntry) => void
}

function StockRow({ stock, onTrade }: StockRowProps) {
  const badge = confidenceLabel(stock.confidence)
  return (
    <div className="flex items-center justify-between p-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-suwappu-purple-deep/10 flex items-center justify-center text-sm font-bold text-suwappu-purple-deep">
          {stock.ticker.slice(0, 2)}
        </div>
        <div>
          <p className="font-heading font-semibold text-sm text-suwappu-text">{stock.ticker}</p>
          <p className="text-[10px] text-suwappu-text-secondary leading-tight">{stock.name}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge.color}`}>
          {badge.text}
        </span>
        <button
          onClick={() => onTrade(stock)}
          className="px-3 py-1.5 bg-suwappu-gradient text-white text-xs font-heading font-bold rounded-suwappu-pill shadow-suwappu-button active:scale-95 transition-transform"
        >
          Trade
        </button>
      </div>
    </div>
  )
}

export function Stocks() {
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery({
    queryKey: ['stocks'],
    queryFn: () => api.getStocks(),
    staleTime: 2 * 60 * 1000,
  })

  // Deep-link into Swap with the selected stock's mint as the "to" token on Solana.
  // Matches the pattern used by TokenDetail.tsx: /swap?to=<address>&chain=solana
  function handleTrade(stock: StockEntry) {
    navigate(`/swap?to=${encodeURIComponent(stock.mint)}&chain=solana`)
  }

  return (
    <AppLayout
      header={<AppHeader title="xStocks" showBack onBack={() => navigate(-1)} />}
      activeNav="earn"
    >
      <div className="p-3 pb-24 space-y-3">

        {/* Loading */}
        {isLoading && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={6} variant="token" />
          </div>
        )}

        {/* Network error */}
        {!isLoading && error && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <span className="text-4xl block mb-2">⚠️</span>
            <p className="font-heading font-semibold text-suwappu-text mb-1">Could not load stocks</p>
            <p className="text-xs text-suwappu-text-secondary">Check your connection and try again</p>
          </div>
        )}

        {/* Geo-blocked */}
        {!isLoading && data && !data.allowed && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <span className="text-4xl block mb-3">🚫</span>
            <p className="font-heading font-bold text-base text-suwappu-text mb-2">
              Not available in your region
            </p>
            <p className="text-sm text-suwappu-text-secondary leading-relaxed">
              {data.blocked_message ?? 'xStocks trading is not available in your current region due to regulatory restrictions.'}
            </p>
            <p className="text-[10px] text-suwappu-text-secondary/60 mt-3">
              Status: {data.region_status}
            </p>
          </div>
        )}

        {/* Allowed — show content */}
        {!isLoading && data?.allowed && (
          <>
            {/* Off-hours warning banner */}
            {data.off_hours_warning && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-suwappu-lg px-3 py-2.5 flex items-start gap-2">
                <span className="text-base mt-0.5">⚠️</span>
                <p className="text-xs text-yellow-800 leading-snug">{data.off_hours_warning}</p>
              </div>
            )}

            {/* Market status badge */}
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-suwappu-pill text-xs font-semibold ${
                  data.market_open
                    ? 'bg-green-50 text-green-700'
                    : 'bg-suwappu-sakura-light text-suwappu-text-secondary'
                }`}
              >
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${data.market_open ? 'bg-green-500' : 'bg-gray-400'}`}
                />
                {data.market_open ? 'Market Open' : 'Market Closed'}
              </span>
              <span className="text-[10px] text-suwappu-text-secondary">{data.region_status}</span>
            </div>

            {/* Stock list */}
            {data.stocks.length > 0 ? (
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden divide-y divide-suwappu-sakura-light/50">
                {data.stocks.map((stock) => (
                  <StockRow key={stock.mint} stock={stock} onTrade={handleTrade} />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
                <span className="text-4xl block mb-2">📈</span>
                <p className="font-heading font-semibold text-suwappu-text mb-1">No stocks available</p>
                <p className="text-xs text-suwappu-text-secondary">Check back later</p>
              </div>
            )}

            {/* Confidence key */}
            <div className="flex items-center gap-3 px-1">
              <span className="text-[10px] text-suwappu-text-secondary font-medium">Confidence:</span>
              {[
                { text: 'High', color: 'text-green-600 bg-green-50' },
                { text: 'Medium', color: 'text-yellow-600 bg-yellow-50' },
                { text: 'Low', color: 'text-suwappu-text-secondary bg-suwappu-sakura-light' },
              ].map((c) => (
                <span key={c.text} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${c.color}`}>
                  {c.text}
                </span>
              ))}
            </div>

            {/* Info */}
            <div className="bg-suwappu-sakura-light/30 rounded-suwappu-lg p-3">
              <p className="text-xs text-suwappu-text-secondary">
                xStocks are tokenized representations of equities on Solana. Tapping Trade opens the Swap
                page with the stock token pre-selected. Confidence reflects oracle price data quality.
                Prices may deviate from US market prices outside trading hours.
              </p>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}
