import { getAuthToken } from './auth'
import type {
  SwapQuoteRequest,
  SwapQuote,
  SwapExecuteRequest,
  SwapExecuteResult,
  CopilotResponse,
  PasskeyAuthInitResponse,
  PasskeyAuthCompleteResponse,
  Portfolio,
  ChainInfo,
  SwapToken,
  OHLCVCandle,
  OrderBookData,
  TerminalTrade,
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
  TrackedWallet,
  TrackedTwitterAccount,
  TweetData,
  WalletActivity,
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

  const res = await fetch(`${BASE_URL}${path}`, { credentials: 'include', ...options, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw { detail: body.detail || body.message || res.statusText, status: res.status }
  }
  return res.json()
}

export const api = {
  // Auth
  async walletChallenge(address: string) {
    const result = await request<{ nonce: string; challenge: string }>('/auth/turnkey/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    })
    return { nonce: result.nonce, message: result.challenge }
  },

  async walletVerify(address: string, signature: string, nonce: string) {
    const result = await request<{
      token: string
      expiresAt: string
      user?: { id?: number }
    }>('/auth/turnkey/verify', {
      method: 'POST',
      body: JSON.stringify({ address, signature, nonce }),
    })
    return { token: result.token, expiresAt: result.expiresAt, userId: result.user?.id ?? 0 }
  },

  async getMe() {
    const result = await request<{
      authenticated: boolean
      userId?: number
      address?: string
    }>('/auth/me')
    if (!result.authenticated || !result.userId || !result.address) {
      throw { detail: 'Not authenticated', status: 401 }
    }
    return { userId: result.userId, walletAddress: result.address }
  },

  passkeyRegisterInit(displayName?: string) {
    return request<{
      challenge: string
      userId: string
      userName: string
      rpId: string
      rpName: string
      attestation: string
    }>('/auth/passkey/register/init', {
      method: 'POST',
      body: JSON.stringify({ displayName }),
    })
  },

  passkeyRegisterComplete(body: {
    credentialId: string
    attestationObject: string
    clientDataJSON: string
    userHandle?: string
    transports: string[]
  }) {
    return request<{
      success: boolean
      userId: number
      walletAddress: string
      subOrgId: string
      token: string
      expiresAt: string
    }>('/auth/passkey/register/complete', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  passkeyAuthenticateInit() {
    return request<PasskeyAuthInitResponse>('/auth/passkey/authenticate/init', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  passkeyAuthenticateComplete(body: {
    credentialId: string
    authenticatorData: string
    clientDataJSON: string
    signature: string
    userHandle?: string
  }) {
    return request<PasskeyAuthCompleteResponse>('/auth/passkey/authenticate/complete', {
      method: 'POST',
      body: JSON.stringify(body),
    })
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

  getOrderBook(symbol = 'ETHUSDC', depth = 15) {
    const params = new URLSearchParams({ symbol, depth: String(depth) })
    return request<OrderBookData>(`/terminal/orderbook?${params}`)
  },

  getRecentTrades(symbol = 'ETHUSDC', limit = 50) {
    const params = new URLSearchParams({ symbol, limit: String(limit) })
    return request<TerminalTrade[]>(`/terminal/trades?${params}`)
  },

  // Portfolio
  getPortfolio() {
    return request<Portfolio>('/webapp/portfolio')
  },

  // Discovery
  getNewPools(chain: string, limit: number) {
    return request<Pool[]>(`/webapp/discovery/new?chain=${chain}&limit=${limit}`)
  },

  getTrendingPools(chain: string, limit: number) {
    return request<Pool[]>(`/webapp/discovery/trending?chain=${chain}&limit=${limit}`)
  },

  getTokenSecurity(chain: string, address: string) {
    return request<TokenSecurity>(`/webapp/discovery/security?chain=${chain}&address=${address}`)
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
    return request<LendingMarket[]>('/webapp/lending/markets')
  },

  getLendingMarket(id: string) {
    return request<LendingMarket>(`/webapp/lending/markets/${id}`)
  },

  // Wallet tracker
  getTrackedWallets() {
    return request<TrackedWallet[]>('/webapp/wallet-tracker/wallets')
  },

  addTrackedWallet(params: { address: string; label?: string; chain?: string }) {
    return request<TrackedWallet>('/webapp/wallet-tracker/wallets', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  removeTrackedWallet(address: string) {
    return request<void>(`/webapp/wallet-tracker/wallets/${encodeURIComponent(address)}`, {
      method: 'DELETE',
    })
  },

  getWalletActivities() {
    return request<WalletActivity[]>('/webapp/wallet-tracker/activities')
  },

  // Tweet monitor
  getTrackedTwitterAccounts() {
    return request<TrackedTwitterAccount[]>('/webapp/tweets/accounts')
  },

  addTrackedTwitterAccount(handle: string) {
    return request<TrackedTwitterAccount>('/webapp/tweets/accounts', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    })
  },

  removeTrackedTwitterAccount(handle: string) {
    return request<void>(`/webapp/tweets/accounts/${encodeURIComponent(handle)}`, {
      method: 'DELETE',
    })
  },

  getTweetFeed() {
    return request<TweetData[]>('/webapp/tweets/feed')
  },

  // Agent / Copilot
  copilotCommand(text: string) {
    return request<CopilotResponse>('/webapp/copilot', {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
  },
}
