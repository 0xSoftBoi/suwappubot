/**
 * API client for Suwappu backend
 *
 * Supports dual authentication:
 * - Telegram initData (primary for Mini App)
 * - JWT token (for Turnkey wallet auth)
 */
import { getInitData } from './telegram'
import { getAuthToken } from './auth'
import type { Portfolio, Swap, ApiError, HealthStatus, UserPreferencesResponse, UpdatePreferencesResponse, UserPreferences, PortfolioPnl, SupportTicket, TicketKind } from '../types/api'
import type { LinkedWallet, AuthChallenge, LinkWalletResponse } from '../types/auth'
import type { SwapToken, SwapQuote, SwapQuoteRequest, SwapExecuteRequest, SwapExecuteResult, SwapStatusResponse } from '../types/swap'
import type { SimulationResult } from '../types/simulation'
import type { SnipeRequest, SnipeResult, LaunchToken } from '../types/snipe'
import type { PredictionMarket, PredictionMarketDetail, PredictionEvent, PredictionTrade, MarketPrice, PredictionPosition, PredictionOrderRequest, PredictionOrderResult } from '../types/prediction'
import type { P2POffersQuery, P2POffersResponse, P2PTradesResponse, P2PMyOffersResponse, P2PStartTradeRequest, P2PStartTradeResult, P2PCreateOfferRequest, P2PCreateOfferResult } from '../types/p2p'

const API_BASE = import.meta.env.VITE_API_URL || ''

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  /**
   * Build auth headers for requests.
   * Includes both Telegram initData and JWT if available.
   * Falls back to dev mode for browser testing.
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}

    // Add Telegram auth header if available (primary for Mini App)
    const initData = getInitData()
    if (initData) {
      headers['X-Telegram-Init-Data'] = initData
    }

    // Add JWT token if available (for Turnkey sessions)
    const token = getAuthToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    // Dev mode: ALWAYS add dev user header on dev API (as fallback for invalid/expired auth)
    const isDev = this.baseUrl.includes('devapi') || this.baseUrl.includes('localhost')
    if (isDev) {
      headers['X-Dev-User-Id'] = '12345'
    }

    return headers
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
      ...(options.headers as Record<string, string>),
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error: ApiError = {
        detail: 'Request failed',
        status: response.status,
      }

      try {
        const body = await response.json()
        error.detail = body.detail || body.message || 'Request failed'
      } catch {
        // Ignore JSON parse errors
      }

      throw error
    }

    return response.json()
  }

  // === Wallet ===

  /**
   * Get or create wallet for authenticated user
   */
  async getOrCreateWallet(): Promise<{ address: string; chain: string }> {
    return this.fetch('/webapp/wallets/default', { method: 'POST' })
  }

  // === Portfolio & Swaps ===

  /**
   * Get current user's portfolio
   */
  async getPortfolio(): Promise<Portfolio> {
    return this.fetch<Portfolio>('/webapp/users/me/portfolio')
  }

  /**
   * Get portfolio PnL analytics for the given time period
   */
  async getPortfolioPnl(period: '7d' | '30d' | '90d' | 'all' = '30d'): Promise<PortfolioPnl> {
    return this.fetch<PortfolioPnl>(`/webapp/portfolio/pnl?period=${period}`)
  }

  /**
   * Get current user's swap history
   */
  async getSwaps(limit = 20, offset = 0): Promise<Swap[]> {
    return this.fetch<Swap[]>(`/webapp/users/me/swaps?limit=${limit}&offset=${offset}`)
  }

  /**
   * Get a specific swap by ID
   */
  async getSwap(id: string): Promise<Swap> {
    return this.fetch<Swap>(`/webapp/users/me/swaps/${id}`)
  }

  // === Billing ===

  /**
   * Create a Stripe card-checkout session for the current user.
   * Returns the hosted checkout URL to open (e.g. via Telegram WebApp.openLink).
   */
  async createStripeCheckout(tier: 'pro' | 'premium'): Promise<{ url: string }> {
    return this.fetch<{ url: string }>(`/webapp/billing/stripe/checkout?tier=${tier}`)
  }

  // === Auth ===

  /**
   * Validate Telegram init data (for testing auth)
   */
  async validateAuth(): Promise<{ valid: boolean; user?: unknown }> {
    return this.fetch('/webapp/validate', { method: 'POST' })
  }

  /**
   * Authenticate Telegram user and auto-create Turnkey wallet if needed.
   * This is the primary auth flow for Telegram Mini App users.
   */
  async telegramAuth(initData: string): Promise<{
    success: boolean
    jwt?: string
    user?: { id: number; telegramId: number; username?: string; firstName?: string; lastName?: string }
    walletAddress?: string | null
    isNewUser?: boolean
    error?: string
  }> {
    return this.fetch('/webapp/telegram/auth', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    })
  }

  // === Health ===

  /**
   * Check API health status
   */
  async getHealth(): Promise<HealthStatus> {
    return this.fetch<HealthStatus>('/health')
  }

  // === Wallet Linking ===

  /**
   * Request a challenge for wallet linking
   */
  async requestWalletChallenge(address: string): Promise<AuthChallenge> {
    return this.fetch<AuthChallenge>('/webapp/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    })
  }

  /**
   * Link a wallet to the current Telegram user
   */
  async linkWallet(address: string, signature: string, nonce: string): Promise<LinkWalletResponse> {
    return this.fetch<LinkWalletResponse>('/webapp/link-wallet', {
      method: 'POST',
      body: JSON.stringify({ address, signature, nonce }),
    })
  }

  /**
   * Get all wallets linked to the current user
   */
  async getLinkedWallets(): Promise<LinkedWallet[]> {
    const response = await this.fetch<{ wallets: LinkedWallet[] }>('/webapp/users/me/wallets')
    return response.wallets || []
  }

  /**
   * Unlink a wallet from the current user
   */
  async unlinkWallet(address: string): Promise<{ success: boolean; message: string }> {
    return this.fetch(`/webapp/wallets/${encodeURIComponent(address)}`, {
      method: 'DELETE',
    })
  }

  // === Tokens & Swap ===

  /**
   * Get available tokens for swapping (PUBLIC API - no auth needed)
   */
  async getTokens(chainId = '1', _includeBalances = true): Promise<SwapToken[]> {
    // Use authenticated fetch so backend can enrich with wallet balances
    const data = await this.fetch<{ chainId: number; tokens: Array<{ address: string; symbol: string; decimals: number; name: string; logoURI?: string; priceUSD?: string; balance?: string }> }>(
      `/webapp/swap/tokens?chainId=${chainId}`
    )

    return data.tokens.map((t) => ({
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      chain: chainId,
      decimals: t.decimals,
      logoUrl: t.logoURI || undefined,
      balance: t.balance,
    }))
  }

  /**
   * Get chains list (PUBLIC API - no auth needed)
   */
  async getChains(): Promise<{ id: number, key: string, name: string }[]> {
    const data = await this.fetch<{ chains: { id: number; key: string; name: string }[] }>(
      '/webapp/swap/chains'
    )
    return data.chains
  }

  /**
   * Get swap quote (REAL API)
   */
  async getSwapQuote(request: SwapQuoteRequest): Promise<SwapQuote> {
    // Convert human-readable amount to wei (smallest unit)
    const decimals = request.fromDecimals || 18
    const amountFloat = parseFloat(request.amount)
    // Use string math to avoid floating point precision issues
    const factor = 10 ** decimals
    const amountWei = BigInt(Math.round(amountFloat * factor)).toString()

    const params = new URLSearchParams({
      fromChain: request.fromChain,
      toChain: request.toChain,
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: amountWei,
    })
    if (request.slippage) params.set('slippage', String(request.slippage / 100))

    return this.fetch<SwapQuote>(`/webapp/swap/quote?${params}`)
  }

  /**
   * Execute a swap (REAL API)
   */
  async executeSwap(request: SwapExecuteRequest): Promise<SwapExecuteResult> {
    return this.fetch<SwapExecuteResult>('/webapp/swap/execute', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  // === Swap Status ===

  /**
   * Get swap status by ID (polls for confirmation)
   */
  async getSwapStatus(swapId: number): Promise<SwapStatusResponse> {
    return this.fetch<SwapStatusResponse>(`/webapp/swap/status/${swapId}`)
  }

  // === Transaction Simulation ===

  /**
   * Simulate a swap to preview balance changes, gas, and risks.
   * May return 404 if simulation endpoint is not yet deployed.
   */
  async simulateSwap(quoteId: string): Promise<SimulationResult> {
    return this.fetch<SimulationResult>('/webapp/swap/simulate', {
      method: 'POST',
      body: JSON.stringify({ quoteId }),
    })
  }

  // === Token Search ===

  /**
   * Search tokens across chains via server-side API
   */
  async searchTokens(query: string, chains?: string[]): Promise<SwapToken[]> {
    const params = new URLSearchParams({ q: query })
    if (chains?.length) params.set('chains', chains.join(','))
    const data = await this.fetch<{ tokens: Array<{ address: string; symbol: string; decimals: number; name: string; chainId: number; logoURI?: string; priceUSD?: string }> }>(
      `/webapp/tokens/search?${params}`
    )
    return data.tokens.map((t) => ({
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      chain: String(t.chainId),
      decimals: t.decimals,
      logoUrl: t.logoURI,
    }))
  }

  /**
   * Get batch token prices
   */
  async getTokenPrices(symbols: string[]): Promise<Record<string, number>> {
    const data = await this.fetch<{ prices: Record<string, number> }>(
      `/webapp/tokens/prices?tokens=${symbols.join(',')}`
    )
    return data.prices
  }

  // === User Preferences ===

  /**
   * Get VIP / tier status including point multiplier
   */
  async getVipStatus(): Promise<{ effective_tier: string; point_multiplier: number; season_volume_usd: number }> {
    return this.fetch('/webapp/me/vip')
  }

  /**
   * Get user preferences (settings page data)
   */
  async getUserPreferences(): Promise<UserPreferencesResponse> {
    return this.fetch<UserPreferencesResponse>('/webapp/users/me/preferences')
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(preferences: Partial<UserPreferences>): Promise<UpdatePreferencesResponse> {
    return this.fetch<UpdatePreferencesResponse>('/webapp/users/me/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    })
  }

  /**
   * Persist the user's language preference server-side (dedicated PATCH route —
   * the general preferences PUT endpoint above does not accept this field)
   */
  async updateLanguage(language: string): Promise<{ success: boolean; language: string }> {
    return this.fetch<{ success: boolean; language: string }>('/webapp/users/me/language', {
      method: 'PATCH',
      body: JSON.stringify({ language }),
    })
  }

  // === Points & Rewards ===

  /**
   * Get user's points stats
   */
  async getPointsStats(): Promise<PointsStats> {
    return this.fetch<PointsStats>('/webapp/users/me/points/stats')
  }

  /**
   * Daily check-in
   */
  async dailyCheckin(): Promise<CheckinResult> {
    return this.fetch<CheckinResult>('/webapp/users/me/points/checkin', { method: 'POST' })
  }

  /**
   * Get points transaction history
   */
  async getPointsHistory(limit = 20, offset = 0): Promise<PointTransaction[]> {
    return this.fetch<PointTransaction[]>(`/webapp/users/me/points/history?limit=${limit}&offset=${offset}`)
  }

  /**
   * Get leaderboard
   */
  async getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
    return this.fetch<LeaderboardEntry[]>(`/webapp/users/me/points/leaderboard?limit=${limit}`)
  }

  /**
   * Get available rewards
   */
  async getRewards(): Promise<Reward[]> {
    return this.fetch<Reward[]>('/webapp/users/me/points/rewards')
  }

  /**
   * Redeem a reward
   */
  async redeemReward(rewardId: number): Promise<RedemptionResult> {
    return this.fetch<RedemptionResult>(`/webapp/users/me/points/redeem/${rewardId}`, { method: 'POST' })
  }

  // === Seasons (convertible points) ===

  /**
   * Get the user's standing in the active season (points, rank, multipliers,
   * estimated token allocation). `season` is null when no season is active.
   */
  async getSeasonStanding(): Promise<SeasonStanding> {
    return this.fetch<SeasonStanding>('/webapp/users/me/points/season')
  }

  /**
   * Get the season leaderboard (top N by season points, with estimated tokens).
   */
  async getSeasonLeaderboard(limit = 20): Promise<SeasonLeaderboardEntry[]> {
    return this.fetch<SeasonLeaderboardEntry[]>(`/webapp/users/me/points/season/leaderboard?limit=${limit}`)
  }

  /**
   * Get the user's season history with their settled snapshots (if any).
   */
  async getSeasons(): Promise<SeasonHistoryEntry[]> {
    return this.fetch<SeasonHistoryEntry[]>('/webapp/users/me/seasons')
  }

  // === DCA (Dollar Cost Averaging) ===

  async getDCAOrders(): Promise<DCAOrder[]> {
    const response = await this.fetch<{ orders: DCAOrder[] }>('/webapp/dca')
    return response.orders
  }

  async getDCAOrder(id: number): Promise<DCAOrder> {
    const response = await this.fetch<{ order: DCAOrder }>(`/webapp/dca/${id}`)
    return response.order
  }

  async createDCAOrder(params: CreateDCAParams): Promise<DCAOrder> {
    const response = await this.fetch<{ order: DCAOrder }>('/webapp/dca', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.order
  }

  async pauseDCAOrder(id: number): Promise<DCAOrder> {
    const response = await this.fetch<{ order: DCAOrder }>(`/webapp/dca/${id}/pause`, { method: 'POST' })
    return response.order
  }

  async resumeDCAOrder(id: number): Promise<DCAOrder> {
    const response = await this.fetch<{ order: DCAOrder }>(`/webapp/dca/${id}/resume`, { method: 'POST' })
    return response.order
  }

  async cancelDCAOrder(id: number): Promise<void> {
    await this.fetch(`/webapp/dca/${id}`, { method: 'DELETE' })
  }

  async getDCAExecutions(id: number): Promise<DCAExecution[]> {
    const response = await this.fetch<{ executions: DCAExecution[] }>(`/webapp/dca/${id}/executions`)
    return response.executions
  }

  async getDCAStats(): Promise<DCAStats> {
    return this.fetch<DCAStats>('/webapp/dca/stats')
  }

  // === Price Alerts ===

  async getAlerts(): Promise<PriceAlert[]> {
    const response = await this.fetch<{ alerts: PriceAlert[] }>('/webapp/alerts')
    return response.alerts
  }

  async createAlert(params: CreateAlertParams): Promise<PriceAlert> {
    const response = await this.fetch<{ alert: PriceAlert }>('/webapp/alerts', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.alert
  }

  async toggleAlert(id: number): Promise<PriceAlert> {
    const response = await this.fetch<{ alert: PriceAlert }>(`/webapp/alerts/${id}/toggle`, { method: 'POST' })
    return response.alert
  }

  async deleteAlert(id: number): Promise<void> {
    await this.fetch(`/webapp/alerts/${id}`, { method: 'DELETE' })
  }

  // === Limit Orders ===

  async getOrders(): Promise<LimitOrder[]> {
    const response = await this.fetch<{ orders: LimitOrder[] }>('/webapp/users/me/limit-orders')
    return response.orders
  }

  async createOrder(params: CreateOrderParams): Promise<LimitOrder> {
    const response = await this.fetch<{ order: LimitOrder }>('/webapp/users/me/limit-orders', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.order
  }

  async cancelOrder(id: number): Promise<void> {
    await this.fetch(`/webapp/users/me/limit-orders/${id}`, { method: 'DELETE' })
  }

  async getOrderFills(id: number): Promise<OrderFill[]> {
    const response = await this.fetch<{ fills: OrderFill[] }>(`/webapp/users/me/limit-orders/${id}/fills`)
    return response.fills
  }

  // === Referrals ===

  async getReferralCode(): Promise<{ referralCode: string; referralLink: string }> {
    return this.fetch('/webapp/referrals/code')
  }

  async getReferralStats(): Promise<ReferralStats> {
    return this.fetch('/webapp/referrals/stats')
  }

  async getReferredUsers(): Promise<ReferredUser[]> {
    const response = await this.fetch<{ referrals: ReferredUser[] }>('/webapp/referrals')
    return response.referrals
  }

  async getReferralLeaderboard(): Promise<ReferralLeaderboardEntry[]> {
    const response = await this.fetch<{ leaderboard: ReferralLeaderboardEntry[] }>('/webapp/referrals/leaderboard')
    return response.leaderboard
  }

  // === Rewards (on-chain fee cashback) ===

  async getRewardsSummary(): Promise<RewardsSummary> {
    return this.fetch('/webapp/rewards/summary')
  }

  async getRewardsClaimPayload(epochIndex: number): Promise<RewardsClaimPayload> {
    return this.fetch(`/webapp/rewards/claim/${epochIndex}`)
  }

  // === Copy Trading ===

  async getTopTraders(filters?: {
    minTrades?: number
    minWinRate?: number
    chain?: string
    sortBy?: string
  }): Promise<TraderEntry[]> {
    const params = new URLSearchParams()
    if (filters?.minTrades !== undefined) params.set('minTrades', String(filters.minTrades))
    if (filters?.minWinRate !== undefined) params.set('minWinRate', String(filters.minWinRate))
    if (filters?.chain) params.set('chain', filters.chain)
    if (filters?.sortBy) params.set('sortBy', filters.sortBy)
    const qs = params.toString()
    const response = await this.fetch<{ traders: TraderEntry[] }>(
      `/webapp/me/copy/top-traders${qs ? `?${qs}` : ''}`
    )
    return response.traders
  }

  async getTraderLeaderboard(sortBy = 'pnl7d', limit = 50): Promise<TraderEntry[]> {
    const response = await this.fetch<{ traders: TraderEntry[] }>(`/webapp/copy/traders?sortBy=${sortBy}&limit=${limit}`)
    return response.traders
  }

  async getTraderProfile(id: number): Promise<CopyTraderProfile> {
    return this.fetch<CopyTraderProfile>(`/webapp/me/copy/trader/${id}`)
  }

  async getWebappFollowing(): Promise<CopyFollowingEntry[]> {
    return this.fetch<CopyFollowingEntry[]>('/webapp/me/copy/following')
  }

  async getWebappCopyTrades(limit = 20, offset = 0): Promise<CopyTradeRecord[]> {
    return this.fetch<CopyTradeRecord[]>(`/webapp/me/copy/trades?limit=${limit}&offset=${offset}`)
  }

  async webappFollowTrader(traderId: number, settings: CopyFollowSettings): Promise<unknown> {
    return this.fetch('/webapp/me/copy/follow/' + traderId, {
      method: 'POST',
      body: JSON.stringify(settings),
    })
  }

  async followTrader(traderId: number, params: FollowTraderParams): Promise<void> {
    await this.fetch(`/webapp/copy/${traderId}`, {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async unfollowTrader(traderId: number): Promise<void> {
    await this.fetch(`/webapp/copy/${traderId}`, { method: 'DELETE' })
  }

  async getFollowing(): Promise<CopyFollow[]> {
    const response = await this.fetch<{ following: CopyFollow[] }>('/webapp/copy/following')
    return response.following
  }

  async getCopySettings(traderId: number): Promise<CopySettings> {
    const response = await this.fetch<{ settings: CopySettings }>(`/webapp/copy/settings/${traderId}`)
    return response.settings
  }

  async updateCopySettings(traderId: number, settings: Partial<CopySettings>): Promise<void> {
    await this.fetch(`/webapp/copy/settings/${traderId}`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  }

  async getMyTraderStats(): Promise<TraderStats | null> {
    const response = await this.fetch<{ stats: TraderStats | null }>('/webapp/copy/my-stats')
    return response.stats
  }

  async setTraderVisibility(isPublic: boolean, displayName?: string): Promise<void> {
    await this.fetch('/webapp/copy/visibility', {
      method: 'POST',
      body: JSON.stringify({ isPublic, displayName }),
    })
  }

  // === Snipe & Launches ===

  /**
   * Snipe a newly launched token
   */
  async snipeToken(request: SnipeRequest): Promise<SnipeResult> {
    return this.fetch<SnipeResult>('/webapp/snipe', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  /**
   * Get active token launches
   */
  async getLaunches(chain?: string): Promise<LaunchToken[]> {
    const params = chain ? `?chain=${encodeURIComponent(chain)}` : ''
    const response = await this.fetch<{ launches: LaunchToken[] }>(`/webapp/launches${params}`)
    return response.launches
  }

  // === Prediction Markets ===

  async getPredictionMarkets(params?: { query?: string; category?: string; limit?: number }): Promise<{ markets: PredictionMarket[] }> {
    const searchParams = new URLSearchParams()
    if (params?.query) searchParams.set('query', params.query)
    if (params?.category) searchParams.set('category', params.category)
    if (params?.limit) searchParams.set('limit', String(params.limit))
    const qs = searchParams.toString()
    return this.fetch(`/webapp/me/predict/markets${qs ? `?${qs}` : ''}`)
  }

  async getPredictionMarket(id: string): Promise<PredictionMarketDetail> {
    return this.fetch<PredictionMarketDetail>(`/webapp/me/predict/market/${encodeURIComponent(id)}`)
  }

  async getPredictionEvents(params?: { query?: string; limit?: number }): Promise<{ events: PredictionEvent[] }> {
    const searchParams = new URLSearchParams()
    if (params?.query) searchParams.set('query', params.query)
    if (params?.limit) searchParams.set('limit', String(params.limit))
    const qs = searchParams.toString()
    return this.fetch(`/webapp/me/predict/events${qs ? `?${qs}` : ''}`)
  }

  async getPredictionOrderbook(id: string): Promise<{ marketId: string; question: string; outcomes: unknown[] }> {
    return this.fetch(`/webapp/me/predict/market/${encodeURIComponent(id)}/book`)
  }

  async getPredictionPrices(id: string): Promise<{ marketId: string; question: string; prices: MarketPrice[] }> {
    return this.fetch(`/webapp/me/predict/market/${encodeURIComponent(id)}/price`)
  }

  async getPredictionTrades(id: string): Promise<{ marketId: string; question: string; trades: PredictionTrade[] }> {
    return this.fetch(`/webapp/me/predict/market/${encodeURIComponent(id)}/trades`)
  }

  async getPredictionPositions(): Promise<{ positions: PredictionPosition[] }> {
    return this.fetch('/webapp/me/predict/positions')
  }

  async placePredictionOrder(order: PredictionOrderRequest): Promise<PredictionOrderResult> {
    return this.fetch<PredictionOrderResult>('/webapp/me/predict/order', {
      method: 'POST',
      body: JSON.stringify(order),
    })
  }

  // === Perps (Hyperliquid) ===

  async getPerpsMarkets(): Promise<{ markets: Array<{ name: string; asset: string; szDecimals: number; maxLeverage: number; markPrice: number; fundingRate: number }> }> {
    return this.fetch('/v1/agent/perps/markets')
  }

  // === P2P Marketplace ===

  async getP2POffers(query: P2POffersQuery): Promise<P2POffersResponse> {
    const params = new URLSearchParams()
    params.set('fiatCurrency', query.fiatCurrency)
    params.set('cryptoAsset', query.cryptoAsset)
    params.set('offerType', query.offerType)
    if (query.fiatAmount != null) params.set('fiatAmount', String(query.fiatAmount))
    if (query.region) params.set('region', query.region)
    return this.fetch(`/webapp/p2p/offers?${params.toString()}`)
  }

  async getP2PTrades(): Promise<P2PTradesResponse> {
    return this.fetch('/webapp/p2p/trades')
  }

  async getP2PMyOffers(): Promise<P2PMyOffersResponse> {
    return this.fetch('/webapp/p2p/offers/mine')
  }

  async startP2PTrade(req: P2PStartTradeRequest): Promise<P2PStartTradeResult> {
    return this.fetch<P2PStartTradeResult>('/webapp/p2p/trades', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  async createP2POffer(req: P2PCreateOfferRequest): Promise<P2PCreateOfferResult> {
    return this.fetch<P2PCreateOfferResult>('/webapp/p2p/offers', {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  // === Subscription Status ===

  /**
   * Get the current user's subscription tier.
   * Returns { tier, fee_rate_percent, expires_at, active }
   */
  async getSubscriptionStatus(): Promise<{ tier: string; fee_rate_percent: number; expires_at: string | null; active: boolean }> {
    return this.fetch<{ tier: string; fee_rate_percent: number; expires_at: string | null; active: boolean }>('/billing/status')
  }

  // === Enterprise Org Management ===

  async getOrg(orgId: string): Promise<EnterpriseOrg> {
    return this.fetch<EnterpriseOrg>(`/enterprise/orgs/${orgId}`)
  }

  async getMySupportTickets(): Promise<SupportTicket[]> {
    return this.fetch<SupportTicket[]>('/webapp/support/tickets')
  }

  async createSupportTicket(params: { kind: TicketKind; message: string }): Promise<SupportTicket> {
    return this.fetch<SupportTicket>('/webapp/support/tickets', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async getMyOrg(): Promise<EnterpriseOrg | null> {
    const res = await fetch(`${this.baseUrl}/enterprise/orgs/me`, {
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
    })
    if (res.status === 404) return null
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw { detail: body.detail || 'Failed to load organization', status: res.status }
    }
    return res.json()
  }

  async createOrg(name: string, slug: string): Promise<EnterpriseOrg> {
    return this.fetch<EnterpriseOrg>('/enterprise/orgs', {
      method: 'POST',
      body: JSON.stringify({ name, slug }),
    })
  }

  async getOrgMembers(orgId: string): Promise<OrgMember[]> {
    const res = await this.fetch<{ members: OrgMember[] }>(`/enterprise/orgs/${orgId}/members`)
    return res.members
  }

  async inviteMember(orgId: string, userId: number, role: OrgRole): Promise<OrgMember> {
    const res = await this.fetch<{ member: OrgMember }>(`/enterprise/orgs/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId: Number(userId), role }),
    })
    return res.member
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.fetch(`/enterprise/orgs/${orgId}/members/${userId}`, { method: 'DELETE' })
  }

  async getApiKeys(orgId: string): Promise<OrgApiKey[]> {
    const res = await this.fetch<{ keys: OrgApiKey[] }>(`/enterprise/orgs/${orgId}/api-keys`)
    return res.keys
  }

  async createApiKey(orgId: string, name: string, scopes: string[], expiresAt?: string): Promise<OrgApiKeyCreated> {
    return this.fetch<OrgApiKeyCreated>(`/enterprise/orgs/${orgId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({ name, scopes, expiresAt }),
    })
  }

  async revokeApiKey(orgId: string, keyId: string): Promise<void> {
    await this.fetch(`/enterprise/orgs/${orgId}/api-keys/${keyId}`, { method: 'DELETE' })
  }

  async getOrgUsage(orgId: string): Promise<OrgUsage> {
    return this.fetch<OrgUsage>(`/enterprise/orgs/${orgId}/usage`)
  }

  // === Battle ===

  /**
   * Get battle feature config (markets, multiplier, durations, max open cap)
   */
  async getBattleConfig(): Promise<BattleConfig> {
    return this.fetch<BattleConfig>('/webapp/battle/config')
  }

  /**
   * List the current user's battles (open + recent)
   */
  async getBattleList(): Promise<BattleEntry[]> {
    return this.fetch<BattleEntry[]>('/webapp/battle/list')
  }

  /**
   * Open a new battle position
   */
  async openBattle(params: OpenBattleParams): Promise<BattleEntry> {
    return this.fetch<BattleEntry>('/webapp/battle/open', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  // === xStocks ===

  /**
   * Get tokenized-stocks page data (geo-check + stock list)
   */
  async getStocks(): Promise<StocksResponse> {
    return this.fetch<StocksResponse>('/webapp/stocks')
  }

  /**
   * Lookup a token by contract address
   */
  async getTokenByAddress(address: string, chain?: string): Promise<{
    name: string
    symbol: string
    price: number | null
    safetyScore: number | null
    chain: string
    address: string
    logoUrl?: string
  } | null> {
    const params = new URLSearchParams({ address })
    if (chain) params.set('chain', chain)
    try {
      return await this.fetch(`/webapp/tokens/lookup?${params}`)
    } catch (err: any) {
      if (err?.status === 404) return null
      throw err
    }
  }
}

// Rewards (on-chain fee cashback) types — mirror api-ts RewardsSummaryView/ClaimPayload
export interface RewardsEntryView {
  epochIndex: number
  amountUsd: number
  cashbackUsd: number
  carryoverUsd: number
  status: string
  claimDeadline: string | null
  claimedTxHash: string | null
  hasOnchainLeaf: boolean
}

export interface RewardsSummary {
  accruingUsd: number
  accruingEpochIndex: number
  accruingEndsAt: string
  claimableUsd: number
  onchainUsd: number
  lifetimeUsd: number
  carryoverUsd: number
  cashbackRate: number
  payoutToken: string
  payoutChain: string
  entries: RewardsEntryView[]
}

export interface RewardsClaimPayload {
  epochId: number
  index: number
  account: string
  amount: string
  merkleProof: string[]
  distributor: string | null
  chainId: number
  claimDeadline: string | null
  alreadyClaimed: boolean | null
}

// Points types
export interface PointsStats {
  totalPoints: number
  currentStreak: number
  longestStreak: number
  lastCheckin: string | null
  canCheckin: boolean
  rank?: number
}

export interface CheckinResult {
  success: boolean
  pointsAwarded: number
  newTotal: number
  streak: number
  bonusPoints?: number
}

export interface PointTransaction {
  id: number
  amount: number
  action: string
  description: string | null
  createdAt: string
}

export interface LeaderboardEntry {
  rank: number
  userId: number
  username: string | null
  firstName: string | null
  totalPoints: number
  currentStreak: number
}

export interface Reward {
  id: number
  name: string
  description: string
  emoji: string
  pointsCost: number
  rewardType: string
  rewardValue: string | null
  stock: number | null
}

export interface RedemptionResult {
  id: number
  pointsSpent: number
  rewardType: string
  rewardValue: string | null
  status: string
  expiresAt: string | null
}

// Season (convertible points) types
export interface Season {
  id: number
  name: string
  slug: string
  status: string
  seasonIndex?: number
  // Weather season name (Summer/Fall/Winter/Spring) + official reporting quarter (e.g. "Q3 2026").
  weather?: string
  quarter?: string
  startsAt: string
  endsAt: string
  tokenPool: number
  tokenSymbol: string
  description: string | null
  daysRemaining: number | null
}

export interface SeasonEmission {
  seasonIndex: number
  totalSeasons: number
  seasonPoolTokens: number
  poolPctOfSupply: number // 0..1
  decayPerSeason: number // e.g. 0.25
  programAllocationPct: number // e.g. 0.30
  inflationRate: number | null
  committed: boolean
}

export interface SeasonStanding {
  season: Season | null
  standing: {
    points: number
    basePoints: number
    rank: number | null
    swapVolumeUsd: number
    referralPoints: number
    feePaidUsd: number
  }
  multiplier: {
    level: number
    streak: number
    combined: number
    levelName: string
  }
  estimatedAllocation: {
    tokens: number
    tokenSymbol: string
    poolShare: number
  }
  totalSeasonPoints: number
  // Optional so older API responses (pre-emission) still type-check.
  emission?: SeasonEmission
}

export interface SeasonLeaderboardEntry {
  rank: number
  userId: number
  username: string | null
  points: number
  estimatedTokens: number
  poolShare: number
}

export interface SeasonSnapshot {
  finalPoints: number
  rank: number | null
  tokenAllocation: number
  tokenSymbol: string
  claimed: boolean
  claimable: boolean
}

export interface SeasonHistoryEntry {
  season: Season
  snapshot: SeasonSnapshot | null
}


// DCA types
export interface DCAOrder {
  id: number
  walletId: number
  fromChain: string
  fromToken: string
  fromTokenSymbol: string
  toChain: string
  toToken: string
  toTokenSymbol: string
  amountPerExecution: string
  amountPerExecutionUsd?: number
  intervalMinutes: number
  totalExecutions?: number
  executedCount: number
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  nextExecutionAt?: string
  createdAt: string
}

export interface DCAExecution {
  id: number
  fromAmount: string
  toAmount?: string
  executionPrice?: number
  status: 'pending' | 'success' | 'failed'
  txHash?: string
  executedAt: string
}

export interface DCAStats {
  totalOrders: number
  activeOrders: number
  totalExecutions: number
  totalAmountSpent: string
}

export interface CreateDCAParams {
  walletId: number
  fromChain: string
  fromToken: string
  fromTokenSymbol: string
  toChain: string
  toToken: string
  toTokenSymbol: string
  amountPerExecution: string
  intervalMinutes: number
  totalExecutions?: number
  maxSlippage?: number
}

// Alert types
export interface PriceAlert {
  id: number
  chain: string
  tokenAddress: string
  tokenSymbol: string
  alertType: 'above' | 'below' | 'change_pct'
  targetPrice?: number
  changePercent?: number
  currentPrice?: number
  isActive: boolean
  isTriggered: boolean
  createdAt: string
}

export interface CreateAlertParams {
  chain: string
  tokenAddress: string
  tokenSymbol: string
  alertType: 'above' | 'below' | 'change_pct'
  targetPrice?: number
  changePercent?: number
}

// Order types
export interface LimitOrder {
  id: number
  walletId: number
  fromChain: string
  fromToken: string
  fromTokenSymbol: string
  toChain: string
  toToken: string
  toTokenSymbol: string
  orderType: 'limit_buy' | 'limit_sell' | 'stop_loss' | 'take_profit'
  side: 'buy' | 'sell'
  amount: string
  triggerPrice: number
  currentPrice?: number
  status: 'pending' | 'executing' | 'filled' | 'cancelled' | 'expired' | 'failed'
  createdAt: string
  expiresAt?: string
}

export interface CreateOrderParams {
  walletId: number
  fromChain: string
  fromToken: string
  fromTokenSymbol: string
  toChain: string
  toToken: string
  toTokenSymbol: string
  orderType: 'limit_buy' | 'limit_sell' | 'stop_loss' | 'take_profit'
  side: 'buy' | 'sell'
  amount: string
  triggerPrice: number
  maxSlippage?: number
  expiresAt?: string
}

export interface OrderFill {
  id: number
  filledAmount: string
  receivedAmount?: string
  fillPrice?: number
  txHash?: string
  status: string
  filledAt: string
}

// Referral types
export interface ReferralStats {
  referral_code: string
  referral_link: string | null
  total_referrals: number
  active_referrals: number
  total_earnings_usd: number
  pending_rewards_usd: number
  pending_rewards_count: number
  code_times_used: number
  tier: 'standard' | 'power' | 'elite'
  reward_rate_pct: number
}

export interface ReferredUser {
  user_id: number
  username?: string
  joined_at: string
  total_rewards_usd: number
}

export interface ReferralLeaderboardEntry {
  rank: number
  username: string
  total_reward_usd: number
}

// Copy Trading types
export interface TraderEntry {
  userId: number
  displayName: string
  totalTrades: number
  winRate: number
  pnl7d: number
  pnl7dPercent: number
  pnl30d: number
  pnl30dPercent: number
  followerCount: number
  copierCount: number
  lastTradeAt?: string
}

export interface TraderStats {
  totalTrades: number
  winRate: number
  totalPnl: number
  pnl7d: number
  pnl30d: number
  followerCount: number
  isPublic: boolean
  displayName?: string
}

export interface CopyFollow {
  id: number
  traderId: number
  walletId: number
  isActive: boolean
  maxAmountPerTrade?: number
  totalBudget?: number
  usedBudget: number
  totalCopiedTrades: number
  totalPnl: number
}

export interface CopySettings {
  traderId: number
  walletId: number
  isActive: boolean
  maxAmountPerTrade?: number
  totalBudget?: number
  stopLossPercent?: number
  takeProfitPercent?: number
}

export interface FollowTraderParams {
  walletId?: number
  maxAmountPerTrade?: number
  totalBudget?: number
  stopLossPercent?: number
  takeProfitPercent?: number
}

// Copy Trading extended types (used by dev branch hooks)
export interface CopyTraderProfile {
  userId: number
  displayName: string
  totalTrades: number
  winRate: number
  pnl7d: number
  pnl30d: number
  followerCount: number
  isFollowing: boolean
}

export interface CopyFollowingEntry {
  traderId: number
  displayName: string
  isActive: boolean
  totalCopiedTrades: number
  totalPnl: number
  maxAmountPerTrade?: number
}

export interface CopyTradeRecord {
  id: number
  traderId: number
  traderDisplayName: string
  fromToken: string
  toToken: string
  amount: string
  status: string
  executedAt: string
  pnl?: number
}

export interface CopyFollowSettings {
  maxAmountPerTrade?: number
  totalBudget?: number
  stopLossPercent?: number
  takeProfitPercent?: number
  isActive?: boolean
}

// Limit Order webapp types (used by dev branch)
export interface WebappLimitOrder extends LimitOrder {
  targetPrice: number
}

// === Enterprise types ===

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface EnterpriseOrg {
  id: string
  name: string
  slug: string
  seatLimit: number
  memberCount: number
  createdAt: string
}

export interface OrgMember {
  userId: string
  username?: string
  firstName?: string
  role: OrgRole
  joinedAt: string
}

export interface OrgApiKey {
  id: string
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt?: string
  expiresAt?: string
  createdAt: string
}

export interface OrgApiKeyCreated extends OrgApiKey {
  rawKey: string
}

export interface OrgUsage {
  callsToday: number
  callsThisMonth: number
  rateLimitHits: number
}

// === Battle types ===

export interface BattleConfig {
  markets: string[]
  multiplier: number
  backings: string[]
  durations_minutes: number[]
  max_open: number
}

export interface BattleEntry {
  id: number
  market: string
  direction: 'up' | 'down'
  stake_usd: number
  backing: string
  status: 'open' | 'won' | 'lost' | 'cancelled'
  outcome: 'win' | 'loss' | null
  pnl_usd: number | null
  expiry_at: string
  created_at: string
}

export interface OpenBattleParams {
  market: string
  direction: 'up' | 'down'
  stake_usd: number
  backing: 'perps' | 'prediction'
  duration_minutes: number
}

// === xStocks types ===

export interface StockEntry {
  ticker: string
  name: string
  mint: string
  confidence: number
}

export interface StocksResponse {
  allowed: boolean
  region_status: string
  blocked_message: string | null
  stocks: StockEntry[]
  market_open: boolean
  off_hours_warning: string | null
}

// Export singleton instance
export const api = new ApiClient(API_BASE)

// Export for testing with different base URLs
export { ApiClient }

