import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { OutcomeBar, OrderBook, RecentTrades, TradePanel, PositionCard } from '../components/prediction'
import { SkeletonCard } from '../components/ui'
import { usePredictionMarket } from '../hooks/usePredictionMarket'
import { usePredictionOrderbook } from '../hooks/usePredictionOrderbook'
import { usePredictionPositions } from '../hooks/usePredictionPositions'

type Tab = 'orderbook' | 'trades' | 'info'

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function formatEndDate(iso: string): string {
  if (!iso) return 'N/A'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function PredictionMarketDetail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<Tab>('orderbook')

  const { data: market, isLoading: marketLoading } = usePredictionMarket(id ?? null)
  const { data: orderbookData } = usePredictionOrderbook(id ?? null)
  const { data: positions } = usePredictionPositions()

  const userPosition = positions?.find((p) => p.marketId === id)

  const tabs: { key: Tab; label: string }[] = [
    { key: 'orderbook', label: 'Orderbook' },
    { key: 'trades', label: 'Trades' },
    { key: 'info', label: 'Info' },
  ]

  return (
    <AppLayout
      header={<AppHeader title="Market" showBack onBack={() => navigate(-1)} />}
      activeNav="earn"
    >
      <div className="p-3 pb-40 space-y-3">
        {marketLoading && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
            <SkeletonCard rows={4} variant="token" />
          </div>
        )}

        {market && (
          <>
            {/* Market header */}
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3 space-y-3">
              <div className="flex gap-3">
                {market.image && (
                  <img
                    src={market.image}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover shrink-0"
                  />
                )}
                <div className="flex-1">
                  <h2 className="font-heading font-bold text-base text-suwappu-text leading-tight">
                    {market.question}
                  </h2>
                  {market.category && (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-suwappu-sakura-light/50 rounded-full text-[10px] font-medium text-suwappu-text-secondary">
                      {market.category}
                    </span>
                  )}
                </div>
              </div>

              <OutcomeBar outcomes={market.outcomes} prices={market.outcomePrices} />

              <div className="grid grid-cols-3 gap-2">
                <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
                  <p className="text-[10px] text-suwappu-text-secondary">Volume</p>
                  <p className="font-heading font-bold text-xs text-suwappu-text">
                    {formatVolume(market.volume)}
                  </p>
                </div>
                <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
                  <p className="text-[10px] text-suwappu-text-secondary">Liquidity</p>
                  <p className="font-heading font-bold text-xs text-suwappu-text">
                    {formatVolume(market.liquidity)}
                  </p>
                </div>
                <div className="bg-suwappu-sakura-light/30 rounded-lg p-2 text-center">
                  <p className="text-[10px] text-suwappu-text-secondary">Ends</p>
                  <p className="font-heading font-bold text-xs text-suwappu-text">
                    {formatEndDate(market.endDate)}
                  </p>
                </div>
              </div>
            </div>

            {/* User position */}
            {userPosition && <PositionCard position={userPosition} />}

            {/* Tab bar */}
            <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 py-2 rounded-md text-xs font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'bg-white text-suwappu-text shadow-xs'
                      : 'text-suwappu-text-secondary'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
              {activeTab === 'orderbook' && (
                <>
                  {orderbookData?.outcomes && orderbookData.outcomes.length > 0 ? (
                    <div className="space-y-4">
                      {(orderbookData.outcomes as Array<{ outcome: string; bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }> }>).map((ob) => (
                        <div key={ob.outcome}>
                          <p className="font-heading font-semibold text-xs text-suwappu-text mb-2">
                            {ob.outcome}
                          </p>
                          <OrderBook bids={ob.bids || []} asks={ob.asks || []} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-xs text-suwappu-text-secondary py-6">
                      No orderbook data available
                    </p>
                  )}
                </>
              )}

              {activeTab === 'trades' && (
                <RecentTrades trades={market.recentTrades || []} />
              )}

              {activeTab === 'info' && (
                <div className="space-y-3">
                  {market.description && (
                    <div>
                      <p className="text-[10px] text-suwappu-text-secondary font-medium mb-1">Description</p>
                      <p className="text-xs text-suwappu-text leading-relaxed">{market.description}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] text-suwappu-text-secondary font-medium mb-1">Market ID</p>
                    <p className="text-xs text-suwappu-text font-mono break-all">{market.conditionId}</p>
                  </div>
                  {market.tokens.length > 0 && (
                    <div>
                      <p className="text-[10px] text-suwappu-text-secondary font-medium mb-1">Tokens</p>
                      {market.tokens.map((t, i) => (
                        <p key={i} className="text-xs text-suwappu-text font-mono break-all">
                          {t.outcome}: {t.token_id}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Trade panel (sticky bottom) */}
            <div className="fixed bottom-0 left-0 right-0 p-3 bg-suwappu-bg/80 backdrop-blur-md border-t border-suwappu-sakura-mid/10 z-40">
              <TradePanel market={market} />
            </div>
          </>
        )}

        {!marketLoading && !market && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
            <span className="text-4xl block mb-2">🔮</span>
            <p className="font-heading font-semibold text-suwappu-text mb-1">Market not found</p>
            <p className="text-xs text-suwappu-text-secondary">
              This market may have been removed or the ID is invalid
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
