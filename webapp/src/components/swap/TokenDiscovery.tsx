import React, { useState, useCallback, useMemo } from 'react'

export interface DiscoveryToken {
  id: string
  symbol: string
  name: string
  chainId: string
  price: number
  priceChange24h: number
  marketCap?: number
  volume24h?: number
  category: ('trending' | 'new' | 'defi' | 'meme' | 'stable')[]
  logoUrl?: string
  isFavorite?: boolean
}

export interface TokenDiscoveryProps {
  onSelectToken?: (token: DiscoveryToken) => void
  onFavorite?: (tokenId: string) => void
  favorites?: string[]
  recentTokens?: DiscoveryToken[]
  className?: string
}

type CategoryFilter = 'all' | 'trending' | 'new' | 'defi' | 'meme' | 'stable'

const CATEGORIES: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'defi', label: 'DeFi' },
  { key: 'meme', label: 'Meme' },
  { key: 'stable', label: 'Stables' },
]

const CHAINS = [
  { id: 'all', label: 'All Chains' },
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'bsc', label: 'BNB' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'arbitrum', label: 'Arbitrum' },
  { id: 'base', label: 'Base' },
  { id: 'solana', label: 'Solana' },
  { id: 'avalanche', label: 'Avalanche' },
]

const CHAIN_COLORS: Record<string, string> = {
  ethereum: 'bg-blue-500',
  bsc: 'bg-yellow-500',
  polygon: 'bg-purple-500',
  arbitrum: 'bg-blue-400',
  base: 'bg-blue-600',
  solana: 'bg-gradient-to-r from-purple-500 to-teal-400',
  avalanche: 'bg-red-500',
}

export const MOCK_TOKENS: DiscoveryToken[] = [
  {
    id: 'eth-1',
    symbol: 'ETH',
    name: 'Ethereum',
    chainId: 'ethereum',
    price: 3245.67,
    priceChange24h: 2.34,
    marketCap: 389_000_000_000,
    volume24h: 14_500_000_000,
    category: ['trending', 'defi'],
  },
  {
    id: 'wbtc-1',
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    chainId: 'ethereum',
    price: 62450.0,
    priceChange24h: 1.12,
    marketCap: 10_200_000_000,
    volume24h: 380_000_000,
    category: ['defi'],
  },
  {
    id: 'sol-1',
    symbol: 'SOL',
    name: 'Solana',
    chainId: 'solana',
    price: 148.32,
    priceChange24h: 5.67,
    marketCap: 65_000_000_000,
    volume24h: 2_800_000_000,
    category: ['trending'],
  },
  {
    id: 'pepe-1',
    symbol: 'PEPE',
    name: 'Pepe',
    chainId: 'ethereum',
    price: 0.00001234,
    priceChange24h: 12.5,
    marketCap: 5_200_000_000,
    volume24h: 1_200_000_000,
    category: ['trending', 'meme'],
  },
  {
    id: 'doge-1',
    symbol: 'DOGE',
    name: 'Dogecoin',
    chainId: 'bsc',
    price: 0.1523,
    priceChange24h: -3.21,
    marketCap: 21_000_000_000,
    volume24h: 890_000_000,
    category: ['meme'],
  },
  {
    id: 'usdc-1',
    symbol: 'USDC',
    name: 'USD Coin',
    chainId: 'ethereum',
    price: 1.0,
    priceChange24h: 0.01,
    marketCap: 33_000_000_000,
    volume24h: 5_600_000_000,
    category: ['stable'],
  },
  {
    id: 'usdt-1',
    symbol: 'USDT',
    name: 'Tether',
    chainId: 'ethereum',
    price: 1.0,
    priceChange24h: -0.02,
    marketCap: 95_000_000_000,
    volume24h: 42_000_000_000,
    category: ['stable'],
  },
  {
    id: 'dai-1',
    symbol: 'DAI',
    name: 'Dai',
    chainId: 'ethereum',
    price: 0.9998,
    priceChange24h: 0.03,
    marketCap: 5_300_000_000,
    volume24h: 230_000_000,
    category: ['stable', 'defi'],
  },
  {
    id: 'arb-1',
    symbol: 'ARB',
    name: 'Arbitrum',
    chainId: 'arbitrum',
    price: 1.24,
    priceChange24h: -1.87,
    marketCap: 3_800_000_000,
    volume24h: 420_000_000,
    category: ['defi', 'new'],
  },
  {
    id: 'aave-1',
    symbol: 'AAVE',
    name: 'Aave',
    chainId: 'ethereum',
    price: 92.45,
    priceChange24h: 3.45,
    marketCap: 1_350_000_000,
    volume24h: 150_000_000,
    category: ['defi', 'trending'],
  },
  {
    id: 'bonk-1',
    symbol: 'BONK',
    name: 'Bonk',
    chainId: 'solana',
    price: 0.00002156,
    priceChange24h: 8.92,
    marketCap: 1_400_000_000,
    volume24h: 340_000_000,
    category: ['meme', 'trending', 'new'],
  },
  {
    id: 'matic-1',
    symbol: 'MATIC',
    name: 'Polygon',
    chainId: 'polygon',
    price: 0.87,
    priceChange24h: -0.54,
    marketCap: 8_100_000_000,
    volume24h: 320_000_000,
    category: ['defi'],
  },
]

function formatPrice(price: number): string {
  if (price >= 1000) return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (price >= 1) return '$' + price.toFixed(2)
  if (price >= 0.01) return '$' + price.toFixed(4)
  return '$' + price.toFixed(8)
}

function formatMarketCap(cap: number): string {
  if (cap >= 1_000_000_000) return '$' + (cap / 1_000_000_000).toFixed(1) + 'B'
  if (cap >= 1_000_000) return '$' + (cap / 1_000_000).toFixed(1) + 'M'
  return '$' + cap.toLocaleString()
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4 text-suwappu-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" strokeLinecap="round" />
    </svg>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  )
}

function TokenCard({
  token,
  isFavorite,
  onSelect,
  onFavorite,
  onSwap,
}: {
  token: DiscoveryToken
  isFavorite: boolean
  onSelect: () => void
  onFavorite: () => void
  onSwap: () => void
}) {
  const chainColor = CHAIN_COLORS[token.chainId] || 'bg-gray-400'
  const chainLabel = CHAINS.find((c) => c.id === token.chainId)?.label || token.chainId

  return (
    <div
      className="bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-1 border border-suwappu-sakura-mid/15 hover:shadow-suwappu-2 transition-shadow p-3 cursor-pointer"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          {/* Token logo placeholder */}
          <div className="w-9 h-9 rounded-suwappu-pill bg-suwappu-sakura-50 flex items-center justify-center text-sm font-bold text-suwappu-magenta shrink-0">
            {token.symbol.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm text-suwappu-text">{token.symbol}</span>
              <span className={`w-2 h-2 rounded-suwappu-pill ${chainColor} shrink-0`} title={chainLabel} />
            </div>
            <p className="text-xs text-suwappu-text-secondary truncate">{token.name}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onFavorite()
          }}
          className="p-0.5 -mr-0.5 -mt-0.5"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <StarIcon filled={isFavorite} />
        </button>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-sm font-semibold text-suwappu-text">{formatPrice(token.price)}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className={`text-xs font-medium ${token.priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {token.priceChange24h >= 0 ? '\u25B2' : '\u25BC'}{' '}
              {token.priceChange24h >= 0 ? '+' : ''}
              {token.priceChange24h.toFixed(2)}%
            </span>
          </div>
          {token.marketCap && (
            <div className="text-[10px] text-suwappu-text-secondary mt-0.5">
              MCap {formatMarketCap(token.marketCap)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onSwap()
          }}
          className="bg-suwappu-magenta/10 text-suwappu-magenta rounded-suwappu-pill text-xs px-3 py-1 font-medium hover:bg-suwappu-magenta/20 transition-colors"
        >
          Swap Now
        </button>
      </div>
    </div>
  )
}

export const TokenDiscovery = React.memo(function TokenDiscovery({
  onSelectToken,
  onFavorite,
  favorites = [],
  recentTokens,
  className = '',
}: TokenDiscoveryProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all')
  const [activeChain, setActiveChain] = useState('all')
  const [localFavorites, setLocalFavorites] = useState<string[]>(favorites)

  const handleFavorite = useCallback(
    (tokenId: string) => {
      setLocalFavorites((prev) =>
        prev.includes(tokenId) ? prev.filter((id) => id !== tokenId) : [...prev, tokenId],
      )
      onFavorite?.(tokenId)
    },
    [onFavorite],
  )

  const filteredTokens = useMemo(() => {
    let tokens = MOCK_TOKENS

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      tokens = tokens.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q),
      )
    }

    // Category filter
    if (activeCategory !== 'all') {
      tokens = tokens.filter((t) => t.category.includes(activeCategory))
    }

    // Chain filter
    if (activeChain !== 'all') {
      tokens = tokens.filter((t) => t.chainId === activeChain)
    }

    return tokens
  }, [searchQuery, activeCategory, activeChain])

  const trendingTokens = useMemo(
    () => MOCK_TOKENS.filter((t) => t.category.includes('trending')).slice(0, 4),
    [],
  )

  const effectiveRecentTokens = recentTokens || MOCK_TOKENS.slice(0, 3)

  return (
    <div className={`bg-suwappu-sakura-50/30 ${className}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <h2 className="font-heading font-semibold text-suwappu-text text-lg">Discover Tokens</h2>
        <p className="text-xs text-suwappu-text-secondary mt-0.5">Find the next token to swap</p>
      </div>

      {/* Search */}
      <div className="px-4 mb-3">
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <SearchIcon />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tokens..."
            className="w-full bg-suwappu-sakura-50 border border-suwappu-sakura-200/30 rounded-suwappu-pill pl-10 pr-4 py-3 text-sm text-suwappu-text placeholder:text-suwappu-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-suwappu-magenta/30 focus:border-suwappu-magenta/30 transition-all"
          />
        </div>
      </div>

      {/* Category filters */}
      <div className="px-4 mb-3">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveCategory(cat.key)}
              className={`px-3 py-1.5 rounded-suwappu-pill text-xs font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat.key
                  ? 'bg-suwappu-magenta text-white'
                  : 'bg-suwappu-sakura-50 text-suwappu-text hover:bg-suwappu-sakura-100'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chain filter pills */}
      <div className="px-4 mb-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {CHAINS.map((chain) => (
            <button
              key={chain.id}
              type="button"
              onClick={() => setActiveChain(chain.id)}
              className={`px-2.5 py-1 rounded-suwappu-pill text-[11px] font-medium whitespace-nowrap transition-colors border ${
                activeChain === chain.id
                  ? 'border-suwappu-magenta bg-suwappu-magenta/5 text-suwappu-magenta'
                  : 'border-suwappu-sakura-200/40 bg-white text-suwappu-text-secondary hover:border-suwappu-sakura-200'
              }`}
            >
              {chain.label}
            </button>
          ))}
        </div>
      </div>

      {/* Trending section (only if not searching and on 'all' category) */}
      {!searchQuery && activeCategory === 'all' && activeChain === 'all' && (
        <div className="px-4 mb-4">
          <h3 className="text-xs font-semibold text-suwappu-text-secondary uppercase tracking-wider mb-2">
            Trending
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {trendingTokens.map((token) => (
              <button
                key={token.id}
                type="button"
                onClick={() => onSelectToken?.(token)}
                className="flex items-center gap-2 bg-white/80 backdrop-blur-sm rounded-suwappu-xl shadow-suwappu-1 border border-suwappu-sakura-mid/15 px-3 py-2 shrink-0 hover:shadow-suwappu-2 transition-shadow"
              >
                <div className="w-6 h-6 rounded-suwappu-pill bg-suwappu-sakura-50 flex items-center justify-center text-[10px] font-bold text-suwappu-magenta">
                  {token.symbol.slice(0, 2)}
                </div>
                <div className="text-left">
                  <span className="text-xs font-semibold text-suwappu-text">{token.symbol}</span>
                  <div className={`text-[10px] font-medium ${token.priceChange24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {token.priceChange24h >= 0 ? '\u25B2' : '\u25BC'} {token.priceChange24h >= 0 ? '+' : ''}
                    {token.priceChange24h.toFixed(1)}%
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recently traded section (only if not searching and on 'all' category) */}
      {!searchQuery && activeCategory === 'all' && activeChain === 'all' && effectiveRecentTokens.length > 0 && (
        <div className="px-4 mb-4">
          <h3 className="text-xs font-semibold text-suwappu-text-secondary uppercase tracking-wider mb-2">
            Recently Traded
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {effectiveRecentTokens.map((token) => (
              <button
                key={token.id}
                type="button"
                onClick={() => onSelectToken?.(token)}
                className="flex items-center gap-2 bg-white/80 rounded-suwappu-lg border border-suwappu-sakura-200/20 px-3 py-2 shrink-0 hover:bg-white transition-colors"
              >
                <div className="w-5 h-5 rounded-suwappu-pill bg-suwappu-sakura-50 flex items-center justify-center text-[9px] font-bold text-suwappu-magenta">
                  {token.symbol.slice(0, 2)}
                </div>
                <span className="text-xs font-medium text-suwappu-text">{token.symbol}</span>
                <span className="text-[10px] text-suwappu-text-secondary">{formatPrice(token.price)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Token list */}
      <div className="px-4 pb-4">
        {!searchQuery && activeCategory === 'all' && activeChain === 'all' && (
          <h3 className="text-xs font-semibold text-suwappu-text-secondary uppercase tracking-wider mb-2">
            All Tokens
          </h3>
        )}
        {searchQuery && (
          <h3 className="text-xs font-semibold text-suwappu-text-secondary uppercase tracking-wider mb-2">
            Results for &ldquo;{searchQuery}&rdquo;
          </h3>
        )}

        {filteredTokens.length > 0 ? (
          <div className="grid gap-2">
            {filteredTokens.map((token) => (
              <TokenCard
                key={token.id}
                token={token}
                isFavorite={localFavorites.includes(token.id)}
                onSelect={() => onSelectToken?.(token)}
                onFavorite={() => handleFavorite(token.id)}
                onSwap={() => onSelectToken?.(token)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-3xl mb-2">&#x1F338;</div>
            <p className="text-sm font-medium text-suwappu-text">No tokens found</p>
            <p className="text-xs text-suwappu-text-secondary mt-1">
              Try a different search term or filter
            </p>
          </div>
        )}
      </div>
    </div>
  )
})
