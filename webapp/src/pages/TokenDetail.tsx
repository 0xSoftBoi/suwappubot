import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { TokenChart } from '../components/charts/TokenChart'
import { AnimatedButton, SkeletonCard } from '../components/ui'
import { useTokenInfo, useTokenChart } from '../hooks/useChart'
import type { CandlestickData, Time } from 'lightweight-charts'

// Format compact number (1.2M, 3.4B, etc.)
function formatCompact(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

// Format price with appropriate decimals
function formatPrice(price: number): string {
  if (price < 0.0001) return `$${price.toExponential(2)}`
  if (price < 1) return `$${price.toFixed(6)}`
  if (price < 100) return `$${price.toFixed(4)}`
  return `$${price.toFixed(2)}`
}

export default function TokenDetail() {
  const { chain = '', address = '' } = useParams<{ chain: string; address: string }>()
  const navigate = useNavigate()
  const [timeframe, setTimeframe] = useState('1h')

  const { data: tokenData, isLoading: infoLoading } = useTokenInfo(chain, address)
  const { data: chartData, isLoading: chartLoading } = useTokenChart(chain, address, timeframe)

  // Extract pair info from DexScreener response
  const pair = tokenData?.pairs?.[0]
  const tokenName = pair?.baseToken?.name || 'Unknown'
  const tokenSymbol = pair?.baseToken?.symbol || '???'
  const price = pair?.priceUsd ? parseFloat(pair.priceUsd) : 0
  const priceChange24h = pair?.priceChange?.h24 || 0
  const marketCap = pair?.marketCap || pair?.fdv || 0
  const volume24h = pair?.volume?.h24 || 0
  const liquidity = pair?.liquidity?.usd || 0

  // Transform chart data to candlestick format
  const candleData: CandlestickData<Time>[] = (chartData?.candles || []).map(c => ({ ...c, time: c.time as unknown as Time }))
  const chartUnsupported = chartData?.unsupported ?? false

  const header = (
    <AppHeader
      title={infoLoading ? 'Loading...' : `${tokenSymbol}`}
      showBack
      onBack={() => navigate(-1)}
    />
  )

  // Mirrors PRESET_AMOUNTS / DEFAULT_PRESETS in bot/handlers/paste_trade.py so
  // the Buy amounts are denominated in the chain's OWN native token. This page
  // previously hardcoded ETH values and an "ETH" label on every chain.
  const NATIVE_BY_CHAIN: Record<string, string> = {
    solana: 'SOL', bsc: 'BNB', bnb: 'BNB', polygon: 'POL', polygon_pos: 'POL',
    avalanche: 'AVAX', avax: 'AVAX', tron: 'TRX', fantom: 'FTM', gnosis: 'XDAI',
    kaia: 'KLAY', flare: 'FLR', rootstock: 'RBTC', sonic: 'S', berachain: 'BERA',
  }
  const PRESETS_BY_NATIVE: Record<string, string[]> = {
    SOL: ['0.1', '0.5', '1', '5'],
    ETH: ['0.01', '0.05', '0.1', '0.5'],
    BNB: ['0.05', '0.1', '0.5', '1'],
    POL: ['10', '50', '100', '500'],
    TRX: ['100', '500', '1000', '5000'],
  }
  const DEFAULT_PRESETS = ['0.01', '0.05', '0.1', '0.5']

  const nativeSymbol = NATIVE_BY_CHAIN[(chain || '').toLowerCase()] || 'ETH'
  const BUY_PRESETS = PRESETS_BY_NATIVE[nativeSymbol] || DEFAULT_PRESETS
  const SELL_PRESETS = [25, 50, 100]

  return (
    <AppLayout header={header}>
      <div className="pb-20">
        {/* Chart */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 mx-3 mt-3 p-2">
          {chartLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <div className="animate-pulse text-suwappu-text-secondary text-sm">Loading chart...</div>
            </div>
          ) : (
            <TokenChart
              data={candleData}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              height={300}
              unsupported={chartUnsupported}
            />
          )}
        </div>

        {/* Token Info */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 mx-3 mt-3 p-4">
          {infoLoading ? (
            <SkeletonCard rows={3} variant="token" />
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="font-heading font-bold text-lg text-suwappu-purple-deep">{tokenName}</h2>
                  <span className="text-xs text-suwappu-text-secondary">{tokenSymbol}</span>
                </div>
                <div className="text-right">
                  <p className="font-heading font-bold text-lg text-suwappu-text">{formatPrice(price)}</p>
                  <span className={`text-xs font-semibold ${
                    priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-suwappu-sakura-light/50 rounded-suwappu-lg p-2">
                  <p className="text-xs text-suwappu-text-secondary">Market Cap</p>
                  <p className="font-heading font-semibold text-sm text-suwappu-text">{formatCompact(marketCap)}</p>
                </div>
                <div className="bg-suwappu-sakura-light/50 rounded-suwappu-lg p-2">
                  <p className="text-xs text-suwappu-text-secondary">Volume 24h</p>
                  <p className="font-heading font-semibold text-sm text-suwappu-text">{formatCompact(volume24h)}</p>
                </div>
                <div className="bg-suwappu-sakura-light/50 rounded-suwappu-lg p-2">
                  <p className="text-xs text-suwappu-text-secondary">Liquidity</p>
                  <p className="font-heading font-semibold text-sm text-suwappu-text">{formatCompact(liquidity)}</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Quick Trade */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 mx-3 mt-3 p-4">
          <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-3">Quick Trade</h3>

          {/* Buy presets */}
          <div className="mb-3">
            <p className="text-xs text-suwappu-text-secondary mb-2">Buy with {nativeSymbol}</p>
            <div className="flex gap-2">
              {BUY_PRESETS.map(amount => (
                <AnimatedButton
                  key={amount}
                  variant="primary"
                  size="sm"
                  onClick={() => navigate(`/swap?to=${address}&chain=${chain}&amount=${amount}`)}
                  className="flex-1 text-xs"
                >
                  {amount} {nativeSymbol}
                </AnimatedButton>
              ))}
            </div>
          </div>

          {/* Sell presets */}
          <div>
            <p className="text-xs text-suwappu-text-secondary mb-2">Sell {tokenSymbol}</p>
            <div className="flex gap-2">
              {SELL_PRESETS.map(pct => (
                <AnimatedButton
                  key={pct}
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/swap?from=${address}&chain=${chain}&sellPct=${pct}`)}
                  className="flex-1 text-xs"
                >
                  {pct}%
                </AnimatedButton>
              ))}
            </div>
          </div>
        </div>

        {/* Pair info */}
        {pair && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 mx-3 mt-3 p-4">
            <h3 className="font-heading font-semibold text-sm text-suwappu-purple-deep mb-2">Pair Info</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-suwappu-text-secondary">DEX</span>
                <span className="text-suwappu-text">{pair.dexId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-suwappu-text-secondary">Pair</span>
                <span className="text-suwappu-text font-mono truncate ml-4">
                  {pair.pairAddress?.slice(0, 6)}...{pair.pairAddress?.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-suwappu-text-secondary">Chain</span>
                <span className="text-suwappu-text capitalize">{pair.chainId}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
