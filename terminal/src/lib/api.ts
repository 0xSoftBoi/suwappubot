import { getAuthToken } from './auth'
import type {
  SwapQuoteRequest,
  SwapQuote,
  SwapExecuteRequest,
  SwapExecuteResult,
  Portfolio,
  ChainInfo,
  SwapToken,
  OHLCVCandle,
  Pool,
  TokenSecurity,
  HLMarket,
  HLPosition,
  PredictionMarket,
  TopTrader,
  TraderProfile,
  FollowedTrader,
  CopyTrade,
  FollowSettings,
  PointsProfile,
  CheckinResponse,
  Milestone,
  RewardStoreResponse,
  RedeemRewardResponse,
  LeaderboardEntry,
  Alert,
  CreateAlertParams,
  DCAOrder,
  CreateDCAParams,
  LendingMarket,
} from '../types/api'

const BASE_URL = import.meta.env.VITE_API_URL || ''

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // Dev mode header
  if (!token && typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    headers['X-Dev-User-Id'] = '12345'
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw { detail: body.detail || body.message || res.statusText, status: res.status }
  }
  return res.json()
}

export const api = {
  // Auth
  walletChallenge(address: string) {
    return request<{ nonce: string; message: string }>('/terminal/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    })
  },

  walletVerify(address: string, signature: string, nonce: string) {
    return request<{ token: string; expiresAt: string; userId: number }>('/terminal/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ address, signature, nonce }),
    })
  },

  getMe() {
    return request<{ userId: number; walletAddress: string }>('/terminal/auth/me')
  },

  // Swap
  getSwapQuote(req: SwapQuoteRequest) {
    return request<SwapQuote>('/webapp/swap/quote', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  },

  executeSwap(req: SwapExecuteRequest) {
    return request<SwapExecuteResult>('/webapp/swap/execute', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  },

  // Tokens
  getPopularTokens(chain?: string) {
    const params = chain ? `?chain=${chain}` : ''
    return request<SwapToken[]>(`/webapp/tokens/popular${params}`)
  },

  searchTokens(query: string, chain?: string) {
    const params = new URLSearchParams({ q: query })
    if (chain) params.set('chain', chain)
    return request<SwapToken[]>(`/webapp/tokens/search?${params}`)
  },

  getChains() {
    return request<ChainInfo[]>('/webapp/chains')
  },

  // Chart
  getOHLCV(pair: string, chain: string, interval: string, limit: number) {
    const params = new URLSearchParams({ pair, chain, interval, limit: String(limit) })
    return request<OHLCVCandle[]>(`/terminal/chart/ohlcv?${params}`)
  },

  // Portfolio
  getPortfolio() {
    return request<Portfolio>('/webapp/portfolio')
  },

  // Discovery
  getNewPools(chain: string, limit: number) {
    return request<Pool[]>(`/public/discovery/new?chain=${chain}&limit=${limit}`)
  },

  getTrendingPools(chain: string, limit: number) {
    return request<Pool[]>(`/public/discovery/trending?chain=${chain}&limit=${limit}`)
  },

  getTokenSecurity(chain: string, address: string) {
    return request<TokenSecurity>(`/public/discovery/security?chain=${chain}&address=${address}`)
  },

  // Perps (HyperLiquid)
  getPerpsMarkets() {
    return request<HLMarket[]>('/v1/agent/perps/markets')
  },

  getPerpsPositions(walletAddress: string) {
    return request<HLPosition[]>(`/v1/agent/perps/positions?address=${walletAddress}`)
  },

  // Predictions (Polymarket)
  getPredictionMarkets(search?: string) {
    const params = search ? `?search=${encodeURIComponent(search)}` : ''
    return request<PredictionMarket[]>(`/v1/agent/predict/markets${params}`)
  },

  // Copy Trading
  getTopTraders(timeframe?: string, limit?: number) {
    const params = new URLSearchParams()
    if (timeframe) params.set('timeframe', timeframe)
    if (limit) params.set('limit', String(limit))
    const qs = params.toString()
    return request<TopTrader[]>(`/webapp/copy-trading/top-traders${qs ? `?${qs}` : ''}`)
  },

  getTraderProfile(traderId: string) {
    return request<TraderProfile>(`/webapp/copy-trading/traders/${traderId}`)
  },

  followTrader(traderId: string, settings: FollowSettings) {
    return request<void>(`/webapp/copy-trading/follow/${traderId}`, {
      method: 'POST',
      body: JSON.stringify(settings),
    })
  },

  unfollowTrader(traderId: string) {
    return request<void>(`/webapp/copy-trading/unfollow/${traderId}`, { method: 'POST' })
  },

  getFollowing() {
    return request<FollowedTrader[]>('/webapp/copy-trading/following')
  },

  getCopyTrades(limit?: number) {
    const params = limit ? `?limit=${limit}` : ''
    return request<CopyTrade[]>(`/webapp/copy-trading/trades${params}`)
  },

  updateFollowSettings(traderId: string, settings: FollowSettings) {
    return request<void>(`/webapp/copy-trading/follow/${traderId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  },

  // Alerts
  getAlerts() {
    return request<Alert[]>('/webapp/alerts')
  },

  createAlert(params: CreateAlertParams) {
    return request<Alert>('/webapp/alerts', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  deleteAlert(alertId: string) {
    return request<void>(`/webapp/alerts/${alertId}`, { method: 'DELETE' })
  },

  // DCA
  getDCAOrders() {
    return request<DCAOrder[]>('/webapp/dca/orders')
  },

  createDCAOrder(params: CreateDCAParams) {
    return request<DCAOrder>('/webapp/dca/orders', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  cancelDCAOrder(orderId: string) {
    return request<void>(`/webapp/dca/orders/${orderId}/cancel`, { method: 'POST' })
  },

  pauseDCAOrder(orderId: string) {
    return request<void>(`/webapp/dca/orders/${orderId}/pause`, { method: 'POST' })
  },

  // Points / Gamification
  getPoints() {
    return request<PointsProfile>('/webapp/points/profile')
  },

  checkin() {
    return request<CheckinResponse>('/webapp/points/checkin', { method: 'POST' })
  },

  getMilestones() {
    return request<Milestone[]>('/webapp/points/milestones')
  },

  getRewardStore() {
    return request<RewardStoreResponse>('/webapp/points/rewards')
  },

  redeemReward(rewardId: string) {
    return request<RedeemRewardResponse>(`/webapp/points/rewards/${rewardId}/redeem`, {
      method: 'POST',
    })
  },

  getPointsLeaderboard(timeframe?: string, limit?: number) {
    const params = new URLSearchParams()
    if (timeframe) params.set('timeframe', timeframe)
    if (limit) params.set('limit', String(limit))
    const qs = params.toString()
    return request<LeaderboardEntry[]>(`/webapp/points/leaderboard${qs ? `?${qs}` : ''}`)
  },

  // Lending
  getLendingMarkets() {
    return request<LendingMarket[]>('/v1/agent/lend/markets')
  },

  getLendingMarket(id: string) {
    return request<LendingMarket>(`/v1/agent/lend/markets/${id}`)
  },

  // Agent / Copilot
  agentSwapQuote(naturalLanguage: string) {
    return request<SwapQuote>('/v1/agent/swap/quote', {
      method: 'POST',
      body: JSON.stringify({ text: naturalLanguage }),
    })
  },
}
