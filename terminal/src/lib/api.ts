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
  TierName,
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

function mapAlert(raw: {
  id: number
  tokenSymbol: string
  tokenAddress?: string
  chain?: string
  condition: 'above' | 'below'
  threshold: number
  active: boolean
  triggered: boolean
  createdAt: string | null
  triggeredAt?: string | null
}): Alert {
  return {
    id: String(raw.id),
    tokenSymbol: raw.tokenSymbol,
    tokenAddress: raw.tokenAddress,
    chain: raw.chain,
    alertType: raw.condition === 'below' ? 'price_below' : 'price_above',
    targetValue: raw.threshold,
    status: raw.triggered ? 'triggered' : raw.active ? 'active' : 'inactive',
    createdAt: raw.createdAt ?? new Date().toISOString(),
    triggeredAt: raw.triggeredAt ?? undefined,
  }
}

function mapDcaOrder(raw: {
  id: number
  fromToken: string
  fromTokenSymbol?: string
  toToken: string
  toTokenSymbol?: string
  amountPerExecution: string
  interval: 'hourly' | 'daily' | 'weekly'
  totalExecutions: number | null
  executionsCompleted: number
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed'
  nextExecutionAt?: string | null
  createdAt: string | null
}): DCAOrder {
  const amountPerOrder = Number(raw.amountPerExecution || 0)
  const totalOrders = raw.totalExecutions ?? 0
  const completedOrders = raw.executionsCompleted ?? 0
  return {
    id: String(raw.id),
    fromToken: raw.fromTokenSymbol || raw.fromToken,
    toToken: raw.toTokenSymbol || raw.toToken,
    amountPerOrder,
    totalAmount: totalOrders > 0 ? amountPerOrder * totalOrders : amountPerOrder,
    totalInvested: amountPerOrder * completedOrders,
    frequency: raw.interval,
    totalOrders,
    completedOrders,
    status: raw.status,
    nextExecution: raw.nextExecutionAt ?? undefined,
    createdAt: raw.createdAt ?? new Date().toISOString(),
  }
}

function mapPointsProfile(raw: {
  xp: number
  level: string
  levelName?: string
  xpToNextLevel: number | null
  dailyStreak: number
  longestStreak: number
  lastCheckin: string | null
  rank: number | null
}): PointsProfile {
  const levelOrder = ['bronze', 'silver', 'gold', 'platinum', 'diamond']
  const numericLevel = Math.max(levelOrder.indexOf(String(raw.level).toLowerCase()) + 1, 1)
  const nextLevelXp = raw.xpToNextLevel != null ? raw.xp + raw.xpToNextLevel : raw.xp
  return {
    xp: raw.xp,
    level: numericLevel,
    tier: (raw.levelName || raw.level || 'Bronze') as PointsProfile['tier'],
    nextLevelXp,
    currentLevelXp: raw.xp,
    streak: raw.dailyStreak,
    longestStreak: raw.longestStreak,
    lastCheckin: raw.lastCheckin,
    rank: raw.rank ?? 0,
  }
}

function mapRewardStore(raw: Array<{
  id: number
  name: string
  description: string
  pointsCost: number
  stock: number
  rewardType: string
}>): RewardStoreResponse {
  return {
    rewards: raw.map((reward) => ({
      id: String(reward.id),
      name: reward.name,
      description: reward.description,
      cost: reward.pointsCost,
      stock: reward.stock,
      category: reward.rewardType,
    })),
    userXp: 0,
  }
}

function mapLeaderboard(entries: Array<{
  rank: number
  username: string | null
  xp: number
  level: string
}>): LeaderboardEntry[] {
  const tierMap: Record<string, TierName> = {
    bronze: 'Bronze',
    silver: 'Silver',
    gold: 'Gold',
    platinum: 'Platinum',
    diamond: 'Diamond',
  }
  return entries.map((entry) => ({
    rank: entry.rank,
    address: entry.username || `user-${entry.rank}`,
    xp: entry.xp,
    level: Math.max(['bronze', 'silver', 'gold', 'platinum', 'diamond'].indexOf(entry.level) + 1, 1),
    tier: tierMap[String(entry.level).toLowerCase()] || 'Bronze',
  }))
}

function mapCheckinResponse(raw: {
  pointsEarned: number
  newStreak: number
}): CheckinResponse {
  return {
    success: true,
    xpEarned: raw.pointsEarned,
    newStreak: raw.newStreak,
    totalXp: 0,
  }
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
    return request<Portfolio>('/webapp/me/portfolio')
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
    if (timeframe) params.set('sortBy', timeframe)
    if (limit) params.set('limit', String(limit))
    const qs = params.toString()
    return request<TopTrader[]>(`/webapp/me/copy/top-traders${qs ? `?${qs}` : ''}`)
  },

  getTraderProfile(traderId: string) {
    return request<TraderProfile>(`/webapp/me/copy/trader/${traderId}`)
  },

  followTrader(traderId: string, settings: FollowSettings) {
    return request<void>(`/webapp/me/copy/follow/${traderId}`, {
      method: 'POST',
      body: JSON.stringify(settings),
    })
  },

  unfollowTrader(traderId: string) {
    return request<void>(`/webapp/me/copy/follow/${traderId}`, { method: 'DELETE' })
  },

  getFollowing() {
    return request<FollowedTrader[]>('/webapp/me/copy/following')
  },

  getCopyTrades(limit?: number) {
    const params = limit ? `?limit=${limit}` : ''
    return request<CopyTrade[]>(`/webapp/me/copy/trades${params}`)
  },

  updateFollowSettings(traderId: string, settings: FollowSettings) {
    return request<void>(`/webapp/me/copy/follow/${traderId}`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  },

  // Alerts
  async getAlerts() {
    const alerts = await request<Array<{
      id: number
      tokenSymbol: string
      tokenAddress?: string
      chain?: string
      condition: 'above' | 'below'
      threshold: number
      active: boolean
      triggered: boolean
      createdAt: string | null
      triggeredAt?: string | null
    }>>('/webapp/me/price-alerts')
    return alerts.map(mapAlert)
  },

  async createAlert(params: CreateAlertParams) {
    const alert = await request<{
      id: number
      tokenSymbol: string
      tokenAddress?: string
      chain?: string
      condition: 'above' | 'below'
      threshold: number
      active: boolean
      triggered: boolean
      createdAt: string | null
      triggeredAt?: string | null
    }>('/webapp/me/price-alerts', {
      method: 'POST',
      body: JSON.stringify({
        chain: params.chain || 'base',
        tokenAddress: params.tokenAddress || params.tokenSymbol,
        tokenSymbol: params.tokenSymbol,
        condition: params.alertType === 'price_below' ? 'below' : 'above',
        threshold: params.targetValue,
      }),
    })
    return mapAlert(alert)
  },

  deleteAlert(alertId: string) {
    return request<void>(`/webapp/me/price-alerts/${alertId}`, { method: 'DELETE' })
  },

  // DCA
  async getDCAOrders() {
    const orders = await request<Array<{
      id: number
      fromToken: string
      fromTokenSymbol?: string
      toToken: string
      toTokenSymbol?: string
      amountPerExecution: string
      interval: 'hourly' | 'daily' | 'weekly'
      totalExecutions: number | null
      executionsCompleted: number
      status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed'
      nextExecutionAt?: string | null
      createdAt: string | null
    }>>('/webapp/me/dca')
    return orders.map(mapDcaOrder)
  },

  async createDCAOrder(params: CreateDCAParams) {
    const order = await request<{
      id: number
      fromToken: string
      fromTokenSymbol?: string
      toToken: string
      toTokenSymbol?: string
      amountPerExecution: string
      interval: 'hourly' | 'daily' | 'weekly'
      totalExecutions: number | null
      executionsCompleted: number
      status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed'
      nextExecutionAt?: string | null
      createdAt: string | null
    }>('/webapp/me/dca', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return mapDcaOrder(order)
  },

  cancelDCAOrder(orderId: string) {
    return request<void>(`/webapp/me/dca/${orderId}`, { method: 'DELETE' })
  },

  pauseDCAOrder(orderId: string) {
    return request<void>(`/webapp/me/dca/${orderId}/pause`, { method: 'POST' })
  },

  // Points / Gamification
  async getPoints() {
    const stats = await request<{
      xp: number
      level: string
      levelName?: string
      xpToNextLevel: number | null
      dailyStreak: number
      longestStreak: number
      lastCheckin: string | null
      rank: number | null
    }>('/webapp/me/points/stats')
    return mapPointsProfile(stats)
  },

  async checkin() {
    const result = await request<{ pointsEarned: number; newStreak: number }>(
      '/webapp/me/points/checkin',
      { method: 'POST' },
    )
    return mapCheckinResponse(result)
  },

  getMilestones() {
    return request<Milestone[]>('/webapp/me/points/milestones')
  },

  async getRewardStore() {
    const [rewards, stats] = await Promise.all([
      request<Array<{
        id: number
        name: string
        description: string
        pointsCost: number
        stock: number
        rewardType: string
      }>>('/webapp/me/points/rewards'),
      request<{ currentPoints?: number; xp?: number }>('/webapp/me/points/stats'),
    ])
    return {
      ...mapRewardStore(rewards),
      userXp: stats.currentPoints ?? stats.xp ?? 0,
    }
  },

  redeemReward(rewardId: string) {
    return request<RedeemRewardResponse>(`/webapp/me/points/redeem/${rewardId}`, {
      method: 'POST',
    })
  },

  async getPointsLeaderboard(timeframe?: string, limit?: number) {
    void timeframe
    const params = new URLSearchParams()
    if (limit) params.set('limit', String(limit))
    const qs = params.toString()
    const leaderboard = await request<Array<{
      rank: number
      username: string | null
      xp: number
      level: string
    }>>(`/webapp/me/points/leaderboard${qs ? `?${qs}` : ''}`)
    return mapLeaderboard(leaderboard)
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
