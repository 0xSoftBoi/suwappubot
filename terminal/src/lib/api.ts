import { getAuthToken } from './auth'
import type {
  SwapQuoteRequest,
  SwapQuote,
  SwapExecuteRequest,
  SwapExecuteResult,
  SwapBuildRequest,
  SwapBuildResult,
  SwapRecordRequest,
  SwapRecordResult,
  TerminalSwap,
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
  PerpsAccountStatus,
  TerminalPerpsPosition,
  PerpsExecuteParams,
  PerpsExecuteResult,
  PredictionPositionRow,
  PredictOrderParams,
  PredictOrderResult,
  PredictRedeemResult,
  TopTrader,
  TraderProfile,
  FollowedTrader,
  CopyTrade,
  FollowSettings,
  PointsProfile,
  CheckinResponse,
  Milestone,
  Reward,
  RewardStoreResponse,
  RedeemRewardResponse,
  LeaderboardEntry,
  Alert,
  CreateAlertParams,
  DCAOrder,
  CreateDCAParams,
  LimitOrder,
  CreateLimitOrderParams,
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

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, { credentials: 'include', ...options, headers })
  } catch {
    // fetch() rejects (TypeError "Load failed" / "Failed to fetch") on network/CORS
    // failures — surface a human message instead of the raw browser error.
    throw { detail: "Can't reach Suwappu right now. Check your connection and try again.", status: 0 }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    const friendly =
      res.status === 401 ? 'Your session expired — reconnect your wallet.'
      : res.status === 403 ? "You don't have access to that."
      : res.status === 429 ? 'Too many requests — slow down a moment.'
      : res.status >= 500 ? 'Server hiccup — please retry in a few seconds.'
      : null
    throw { detail: body.detail || body.message || friendly || res.statusText, status: res.status }
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

  // Solana (Phantom) SIWS auth — mirrors the EVM challenge/verify but ed25519.
  async solanaChallenge(address: string) {
    const result = await request<{ nonce: string; challenge: string }>('/auth/solana/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    })
    return { nonce: result.nonce, message: result.challenge }
  },

  async solanaVerify(address: string, signature: string, nonce: string) {
    const result = await request<{
      token: string
      expiresAt: string
      user?: { id?: number }
    }>('/auth/solana/verify', {
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
      walletProvider?: string
    }>('/auth/me')
    if (!result.authenticated || !result.userId || !result.address) {
      throw { detail: 'Not authenticated', status: 401 }
    }
    return {
      userId: result.userId,
      walletAddress: result.address,
      walletProvider: result.walletProvider ?? null,
    }
  },

  // Telegram Mini App login: validate the WebApp initData server-side (HMAC over
  // the bot token), resolve/create the user + wallet, and mint the same session
  // JWT the passkey/OAuth flows mint (also sets the httponly suwappu_auth cookie).
  async telegramAuth(initData: string) {
    const result = await request<{
      token: string
      expiresAt: string
      user?: { id?: number }
      address?: string
    }>('/auth/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Init-Data': initData },
      body: JSON.stringify({ initData }),
    })
    return {
      token: result.token,
      expiresAt: result.expiresAt,
      userId: result.user?.id ?? 0,
      walletAddress: result.address ?? '',
    }
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

  // OAuth (Google one-tap / social login). The start endpoint 302-redirects to
  // the provider, so callers must do a full-page navigation to oauthStartUrl()
  // rather than fetch() it (XHR can't follow the cross-origin redirect).
  oauthStartUrl(provider: 'google' | 'twitter', redirectUrl: string) {
    const params = new URLSearchParams({ redirect_url: redirectUrl })
    return `${BASE_URL}/auth/oauth/${provider}/authorize?${params}`
  },

  // Forward the provider's callback (code+state) to the backend so it can
  // exchange the code, provision/link the wallet, mint the session JWT and set
  // the httponly cookie. Returns the backend's callback URL so the caller can
  // do a full-page navigation (which lets the browser persist the Set-Cookie
  // from the backend's 302 response).
  oauthCallbackUrl(provider: 'google' | 'twitter', search: string) {
    const qs = search.startsWith('?') ? search.slice(1) : search
    return `${BASE_URL}/auth/oauth/${provider}/callback?${qs}`
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

  // Non-custodial swap: build unsigned tx(s) for the connected external wallet to
  // sign client-side (server holds no key), then record the broadcast tx hash.
  buildSwap(req: SwapBuildRequest) {
    return request<SwapBuildResult>('/webapp/swap/build', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  },

  recordSwap(req: SwapRecordRequest) {
    return request<SwapRecordResult>('/webapp/swap/record', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  },

  // Swap history for the current session (JWT auth) — terminal/external-wallet
  // users can't reach the Telegram-only /users/me/swaps, so this is the parallel.
  getSwaps(limit = 25) {
    return request<TerminalSwap[]>(`/webapp/swaps?limit=${limit}`)
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

  // Portfolio — real route: GET /webapp/me/portfolio
  getPortfolio() {
    return request<Portfolio>('/webapp/me/portfolio')
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

  // Perps (HyperLiquid). api-ts wraps these in { markets } / { positions };
  // unwrap to the bare array the panels expect (else markets.find/map -> TypeError).
  getPerpsMarkets() {
    return request<{ markets: HLMarket[] }>('/v1/agent/perps/markets').then((r) => r.markets ?? [])
  },

  getPerpsPositions(walletAddress: string) {
    return request<{ positions: HLPosition[] }>(
      `/v1/agent/perps/positions?address=${walletAddress}`
    ).then((r) => r.positions ?? [])
  },

  // Predictions (Polymarket). Also wrapped in { markets }.
  getPredictionMarkets(search?: string) {
    const params = search ? `?search=${encodeURIComponent(search)}` : ''
    return request<{ markets: PredictionMarket[] }>(
      `/v1/agent/predict/markets${params}`
    ).then((r) => r.markets ?? [])
  },

  // === Terminal trading execution (Python /terminal/* routes, session-JWT auth) ===
  // These are the browser-callable write paths that reuse the same proven
  // perps_service + Polymarket client the Telegram bot trades through.

  getPerpsAccount() {
    return request<PerpsAccountStatus>('/terminal/perps/account')
  },

  connectPerps(apiKey: string, apiSecret: string) {
    return request<PerpsAccountStatus>('/terminal/perps/connect', {
      method: 'POST',
      body: JSON.stringify({ apiKey, apiSecret }),
    })
  },

  getTerminalPerpsPositions() {
    return request<{ positions: TerminalPerpsPosition[] }>(
      '/terminal/perps/positions'
    ).then((r) => r.positions ?? [])
  },

  executePerps(params: PerpsExecuteParams) {
    return request<PerpsExecuteResult>('/terminal/perps/execute', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  closePerps(positionId: number, percent = 100) {
    return request<{ ok: boolean; result: unknown }>('/terminal/perps/close', {
      method: 'POST',
      body: JSON.stringify({ positionId, percent }),
    })
  },

  getPredictionPositions() {
    return request<{ positions: PredictionPositionRow[] }>(
      '/terminal/predict/positions'
    ).then((r) => r.positions ?? [])
  },

  placePredictionOrder(params: PredictOrderParams) {
    return request<PredictOrderResult>('/terminal/predict/order', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  redeemPrediction(positionId: number) {
    return request<PredictRedeemResult>('/terminal/predict/redeem', {
      method: 'POST',
      body: JSON.stringify({ positionId }),
    })
  },

  // Copy Trading — real routes live under /webapp/me/copy/* and /webapp/copy/* (telegramAuth)
  getTopTraders(timeframe?: string, limit?: number) {
    const params = new URLSearchParams()
    if (timeframe) params.set('timeframe', timeframe)
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
    // Backend uses DELETE /webapp/me/copy/follow/:traderId
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
    // Backend uses PUT /webapp/me/copy/follow/:traderId
    return request<void>(`/webapp/me/copy/follow/${traderId}`, {
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

  // Limit Orders — real routes: GET/POST /webapp/me/limit-orders, DELETE /webapp/me/limit-orders/:id
  getLimitOrders() {
    return request<LimitOrder[]>('/webapp/me/limit-orders')
  },

  createLimitOrder(params: CreateLimitOrderParams) {
    return request<LimitOrder>('/webapp/me/limit-orders', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  cancelLimitOrder(orderId: string) {
    // Backend expects DELETE (not POST) to cancel
    return request<void>(`/webapp/me/limit-orders/${orderId}`, { method: 'DELETE' })
  },

  // Points / Gamification — real routes under /webapp/me/points/*
  getPoints() {
    // Real route: GET /webapp/me/points/stats
    return request<PointsProfile>('/webapp/me/points/stats')
  },

  checkin() {
    return request<CheckinResponse>('/webapp/me/points/checkin', { method: 'POST' })
  },

  getMilestones() {
    // No milestones endpoint exists in backend — returns history instead (closest available).
    // Panel falls back to empty array gracefully.
    return request<Milestone[]>('/webapp/me/points/history')
  },

  getRewardStore() {
    // Real route: GET /webapp/me/points/rewards (returns raw reward array, not wrapped)
    return request<Reward[]>('/webapp/me/points/rewards').then((rewards) => ({
      rewards,
      userXp: 0, // will be filled by getPoints()
    })) as Promise<RewardStoreResponse>
  },

  redeemReward(rewardId: string) {
    // Real route: POST /webapp/me/points/redeem/:rewardId (not /rewards/:id/redeem)
    return request<RedeemRewardResponse>(`/webapp/me/points/redeem/${rewardId}`, {
      method: 'POST',
    })
  },

  getPointsLeaderboard(timeframe?: string, limit?: number) {
    const params = new URLSearchParams()
    if (timeframe) params.set('timeframe', timeframe)
    if (limit) params.set('limit', String(limit))
    const qs = params.toString()
    return request<LeaderboardEntry[]>(`/webapp/me/points/leaderboard${qs ? `?${qs}` : ''}`)
  },

  // Lending — real routes: GET /v1/agent/lend/markets and /v1/agent/lend/market/:id
  // These endpoints are public (no agentBearerAuth) and callable from the browser.
  getLendingMarkets() {
    return request<{ markets: LendingMarket[] }>('/v1/agent/lend/markets').then((r) => r.markets ?? [])
  },

  getLendingMarket(id: string) {
    return request<LendingMarket>(`/v1/agent/lend/market/${id}`)
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
