/**
 * Platform-agnostic API client for Suwappu
 *
 * Both webapp and mobile apps extend this with their own auth header logic.
 * This base class handles fetch, error parsing, and endpoint methods.
 */
import type { Portfolio, Swap, ApiError, HealthStatus, UserPreferencesResponse, UpdatePreferencesResponse, UserPreferences } from '../types/api'
import type { LinkedWallet, AuthChallenge, LinkWalletResponse, RegistrationInitResponse, AuthenticationInitResponse, PasskeyAuthResult } from '../types/auth'
import type { SwapToken, SwapQuote, SwapQuoteRequest, SwapExecuteRequest, SwapExecuteResult, SwapStatusResponse } from '../types/swap'
import type { PriceAlert, CreateAlertRequest, UpdateAlertRequest } from '../types/alerts'
import type { LimitOrder, CreateOrderRequest, DCAOrder, CreateDCARequest, DCAExecution } from '../types/orders'
import type { TraderProfile, CopyFollow, FollowTraderRequest, CopyTrade } from '../types/copy-trading'
import type { UserPointsInfo, Milestone, Reward, PointTransaction, LeaderboardEntry } from '../types/points'
import type { ReferralCode, ReferralStats, Referral } from '../types/referral'
import type { SnipeOrder, CreateSnipeRequest, SnipeConfig, SnipeHistory, AutoSnipeRule, WatchedToken } from '../types/sniping'
import type {
  TelegramAuthResult,
  SimulationResult,
  WebappSnipeRequest,
  WebappSnipeResult,
  LaunchToken,
  TokenLookupResult,
  WebappPointsStats,
  WebappCheckinResult,
  WebappPointTransaction,
  WebappLeaderboardEntry,
  WebappReward,
  WebappRedemptionResult,
  WebappDCAOrder,
  WebappDCAExecution,
  WebappDCAStats,
  WebappCreateDCAParams,
  WebappPriceAlert,
  WebappCreateAlertParams,
  WebappLimitOrder,
  WebappCreateOrderParams,
  WebappOrderFill,
  WebappReferralStats,
  WebappReferredUser,
  WebappTraderEntry,
  WebappTraderStats,
  WebappCopyFollow,
  WebappCopySettings,
  WebappFollowTraderParams,
  WebappCopyTraderProfile,
  WebappCopyFollowingEntry,
  WebappCopyTradeRecord,
  WebappCopyFollowSettings,
} from '../types/webapp'

export abstract class BaseApiClient {
  protected baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  /**
   * Subclasses must implement auth header injection.
   */
  protected abstract getAuthHeaders(): Record<string, string>

  protected async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
        // ignore
      }
      throw error
    }

    return response.json()
  }

  // === Health ===

  async getHealth(): Promise<HealthStatus> {
    return this.fetch<HealthStatus>('/health')
  }

  // === Auth (Telegram) ===

  async telegramAuth(initData: string): Promise<TelegramAuthResult> {
    return this.fetch<TelegramAuthResult>('/webapp/telegram/auth', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    })
  }

  async validateAuth(): Promise<{ valid: boolean; user?: unknown }> {
    return this.fetch('/webapp/validate', { method: 'POST' })
  }

  // === Auth (Passkey) ===

  async passkeyRegisterInit(displayName?: string): Promise<RegistrationInitResponse> {
    return this.fetch<RegistrationInitResponse>('/auth/passkey/register/init', {
      method: 'POST',
      body: JSON.stringify({ displayName }),
    })
  }

  async passkeyRegisterComplete(credential: unknown): Promise<PasskeyAuthResult> {
    return this.fetch<PasskeyAuthResult>('/auth/passkey/register/complete', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    })
  }

  async passkeyAuthenticateInit(): Promise<AuthenticationInitResponse> {
    return this.fetch<AuthenticationInitResponse>('/auth/passkey/authenticate/init', {
      method: 'POST',
    })
  }

  async passkeyAuthenticateComplete(credential: unknown): Promise<PasskeyAuthResult> {
    return this.fetch<PasskeyAuthResult>('/auth/passkey/authenticate/complete', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    })
  }

  async getMe(): Promise<{ authenticated: boolean; address?: string; userId?: number }> {
    return this.fetch('/auth/me')
  }

  async logout(): Promise<void> {
    await this.fetch('/auth/logout', { method: 'POST' })
  }

  // === Wallet ===

  async getOrCreateWallet(): Promise<{ address: string; chain: string }> {
    return this.fetch('/webapp/wallets/default', { method: 'POST' })
  }

  async getLinkedWallets(): Promise<LinkedWallet[]> {
    return this.fetch<LinkedWallet[]>('/webapp/users/me/wallets')
  }

  async unlinkWallet(address: string): Promise<{ success: boolean; message: string }> {
    return this.fetch(`/webapp/wallets/${encodeURIComponent(address)}`, { method: 'DELETE' })
  }

  async requestWalletChallenge(address: string): Promise<AuthChallenge> {
    return this.fetch<AuthChallenge>('/webapp/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    })
  }

  async linkWallet(address: string, signature: string, nonce: string): Promise<LinkWalletResponse> {
    return this.fetch<LinkWalletResponse>('/webapp/link-wallet', {
      method: 'POST',
      body: JSON.stringify({ address, signature, nonce }),
    })
  }

  // === Portfolio & Swaps ===

  async getPortfolio(): Promise<Portfolio> {
    return this.fetch<Portfolio>('/webapp/users/me/portfolio')
  }

  async getSwaps(limit = 20, offset = 0): Promise<Swap[]> {
    return this.fetch<Swap[]>(`/webapp/users/me/swaps?limit=${limit}&offset=${offset}`)
  }

  async getSwap(id: string): Promise<Swap> {
    return this.fetch<Swap>(`/swaps/${id}`)
  }

  // === Tokens & Chains (public) ===

  async getTokens(chainId = '1'): Promise<SwapToken[]> {
    const response = await fetch(`${this.baseUrl}/tokens?chainId=${chainId}`)
    if (!response.ok) throw new Error('Failed to fetch tokens')
    const data = await response.json()
    return data.tokens.map((t: any) => ({
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      chain: chainId,
      decimals: t.decimals,
      logoUrl: t.logoURI || t.logoUrl,
    }))
  }

  async getChains(): Promise<{ id: number; key: string; name: string }[]> {
    const response = await fetch(`${this.baseUrl}/chains`)
    if (!response.ok) throw new Error('Failed to fetch chains')
    const data = await response.json()
    return data.chains
  }

  // === Token Search & Prices ===

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

  async getTokenPrices(symbols: string[]): Promise<Record<string, number>> {
    const data = await this.fetch<{ prices: Record<string, number> }>(
      `/webapp/tokens/prices?tokens=${symbols.join(',')}`
    )
    return data.prices
  }

  async getTokenByAddress(address: string, chain?: string): Promise<TokenLookupResult | null> {
    const params = new URLSearchParams({ address })
    if (chain) params.set('chain', chain)
    try {
      return await this.fetch<TokenLookupResult>(`/webapp/tokens/lookup?${params}`)
    } catch (err: any) {
      if (err?.status === 404) return null
      throw err
    }
  }

  // === Swap ===

  async getSwapQuote(request: SwapQuoteRequest): Promise<SwapQuote> {
    const params = new URLSearchParams({
      fromChain: request.fromChain,
      toChain: request.toChain,
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.amount,
    })
    if (request.slippage) params.set('slippage', String(request.slippage / 100))
    return this.fetch<SwapQuote>(`/webapp/swap/quote?${params}`)
  }

  async executeSwap(request: SwapExecuteRequest): Promise<SwapExecuteResult> {
    return this.fetch<SwapExecuteResult>('/webapp/swap/execute', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async getSwapStatus(swapId: number): Promise<SwapStatusResponse> {
    return this.fetch<SwapStatusResponse>(`/webapp/swap/status/${swapId}`)
  }

  async simulateSwap(quoteId: string): Promise<SimulationResult> {
    return this.fetch<SimulationResult>('/webapp/swap/simulate', {
      method: 'POST',
      body: JSON.stringify({ quoteId }),
    })
  }

  // === User Preferences ===

  async getUserPreferences(): Promise<UserPreferencesResponse> {
    return this.fetch<UserPreferencesResponse>('/v1/me')
  }

  async updateUserPreferences(preferences: Partial<UserPreferences>): Promise<UpdatePreferencesResponse> {
    return this.fetch<UpdatePreferencesResponse>('/v1/me/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    })
  }

  // === Push Notifications ===

  async registerPushToken(token: string): Promise<{ success: boolean }> {
    return this.fetch('/v1/me/push-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  async unregisterPushToken(): Promise<{ success: boolean }> {
    return this.fetch('/v1/me/push-token', { method: 'DELETE' })
  }

  // === Alerts (v1 API) ===

  async getAlerts(activeOnly = false): Promise<PriceAlert[]> {
    const params = activeOnly ? '?active_only=true' : ''
    return this.fetch<PriceAlert[]>(`/v1/alerts${params}`)
  }

  async getAlert(id: number): Promise<PriceAlert> {
    return this.fetch<PriceAlert>(`/v1/alerts/${id}`)
  }

  async createAlert(request: CreateAlertRequest): Promise<PriceAlert> {
    return this.fetch<PriceAlert>('/v1/alerts', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async updateAlert(id: number, request: UpdateAlertRequest): Promise<PriceAlert> {
    return this.fetch<PriceAlert>(`/v1/alerts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    })
  }

  async deleteAlert(id: number): Promise<{ success: boolean }> {
    return this.fetch(`/v1/alerts/${id}`, { method: 'DELETE' })
  }

  // === Alerts (webapp API) ===

  async getWebappAlerts(): Promise<WebappPriceAlert[]> {
    const response = await this.fetch<{ alerts: WebappPriceAlert[] }>('/webapp/alerts')
    return response.alerts
  }

  async createWebappAlert(params: WebappCreateAlertParams): Promise<WebappPriceAlert> {
    const response = await this.fetch<{ alert: WebappPriceAlert }>('/webapp/alerts', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.alert
  }

  async toggleAlert(id: number): Promise<WebappPriceAlert> {
    const response = await this.fetch<{ alert: WebappPriceAlert }>(`/webapp/alerts/${id}/toggle`, { method: 'POST' })
    return response.alert
  }

  async deleteWebappAlert(id: number): Promise<void> {
    await this.fetch(`/webapp/alerts/${id}`, { method: 'DELETE' })
  }

  // === Limit Orders (v1 API) ===

  async getOrders(status?: string): Promise<LimitOrder[]> {
    const params = status ? `?status=${status}` : ''
    return this.fetch<LimitOrder[]>(`/v1/orders${params}`)
  }

  async getOrder(id: number): Promise<LimitOrder> {
    return this.fetch<LimitOrder>(`/v1/orders/${id}`)
  }

  async createOrder(request: CreateOrderRequest): Promise<LimitOrder> {
    return this.fetch<LimitOrder>('/v1/orders', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async cancelOrder(id: number): Promise<{ success: boolean }> {
    return this.fetch(`/v1/orders/${id}/cancel`, { method: 'PUT' })
  }

  // === Limit Orders (webapp API) ===

  async getWebappOrders(): Promise<WebappLimitOrder[]> {
    const response = await this.fetch<{ orders: WebappLimitOrder[] }>('/webapp/users/me/limit-orders')
    return response.orders
  }

  async createWebappOrder(params: WebappCreateOrderParams): Promise<WebappLimitOrder> {
    const response = await this.fetch<{ order: WebappLimitOrder }>('/webapp/users/me/limit-orders', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.order
  }

  async cancelWebappOrder(id: number): Promise<void> {
    await this.fetch(`/webapp/users/me/limit-orders/${id}`, { method: 'DELETE' })
  }

  async getOrderFills(id: number): Promise<WebappOrderFill[]> {
    const response = await this.fetch<{ fills: WebappOrderFill[] }>(`/webapp/users/me/limit-orders/${id}/fills`)
    return response.fills
  }

  // === DCA (v1 API) ===

  async getDCAOrders(status?: string): Promise<DCAOrder[]> {
    const params = status ? `?status=${status}` : ''
    return this.fetch<DCAOrder[]>(`/v1/dca${params}`)
  }

  async getDCAOrder(id: number): Promise<DCAOrder> {
    return this.fetch<DCAOrder>(`/v1/dca/${id}`)
  }

  async createDCAOrder(request: CreateDCARequest): Promise<DCAOrder> {
    return this.fetch<DCAOrder>('/v1/dca', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async pauseDCA(id: number): Promise<{ success: boolean }> {
    return this.fetch(`/v1/dca/${id}/pause`, { method: 'PUT' })
  }

  async resumeDCA(id: number): Promise<{ success: boolean }> {
    return this.fetch(`/v1/dca/${id}/resume`, { method: 'PUT' })
  }

  async cancelDCA(id: number): Promise<{ success: boolean }> {
    return this.fetch(`/v1/dca/${id}`, { method: 'DELETE' })
  }

  async getDCAExecutions(id: number): Promise<DCAExecution[]> {
    return this.fetch<DCAExecution[]>(`/v1/dca/${id}/executions`)
  }

  // === DCA (webapp API) ===

  async getWebappDCAOrders(): Promise<WebappDCAOrder[]> {
    const response = await this.fetch<{ orders: WebappDCAOrder[] }>('/webapp/dca')
    return response.orders
  }

  async getWebappDCAOrder(id: number): Promise<WebappDCAOrder> {
    const response = await this.fetch<{ order: WebappDCAOrder }>(`/webapp/dca/${id}`)
    return response.order
  }

  async createWebappDCAOrder(params: WebappCreateDCAParams): Promise<WebappDCAOrder> {
    const response = await this.fetch<{ order: WebappDCAOrder }>('/webapp/dca', {
      method: 'POST',
      body: JSON.stringify(params),
    })
    return response.order
  }

  async pauseWebappDCA(id: number): Promise<WebappDCAOrder> {
    const response = await this.fetch<{ order: WebappDCAOrder }>(`/webapp/dca/${id}/pause`, { method: 'POST' })
    return response.order
  }

  async resumeWebappDCA(id: number): Promise<WebappDCAOrder> {
    const response = await this.fetch<{ order: WebappDCAOrder }>(`/webapp/dca/${id}/resume`, { method: 'POST' })
    return response.order
  }

  async cancelWebappDCA(id: number): Promise<void> {
    await this.fetch(`/webapp/dca/${id}`, { method: 'DELETE' })
  }

  async getWebappDCAExecutions(id: number): Promise<WebappDCAExecution[]> {
    const response = await this.fetch<{ executions: WebappDCAExecution[] }>(`/webapp/dca/${id}/executions`)
    return response.executions
  }

  async getDCAStats(): Promise<WebappDCAStats> {
    return this.fetch<WebappDCAStats>('/webapp/dca/stats')
  }

  // === Copy Trading (v1 API) ===

  async getTraders(sort = 'rank_score', limit = 20): Promise<TraderProfile[]> {
    return this.fetch<TraderProfile[]>(`/v1/traders?sort=${sort}&limit=${limit}`)
  }

  async getTrader(id: number): Promise<TraderProfile> {
    return this.fetch<TraderProfile>(`/v1/traders/${id}`)
  }

  async getMyTraderProfile(): Promise<TraderProfile> {
    return this.fetch<TraderProfile>('/v1/traders/me/profile')
  }

  async updateMyTraderProfile(data: { displayName?: string; bio?: string; emoji?: string; isPublic?: boolean }): Promise<TraderProfile> {
    return this.fetch<TraderProfile>('/v1/traders/me/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async followTrader(traderId: number, settings: FollowTraderRequest): Promise<CopyFollow> {
    return this.fetch<CopyFollow>(`/v1/copy/follow/${traderId}`, {
      method: 'POST',
      body: JSON.stringify(settings),
    })
  }

  async unfollowTrader(traderId: number): Promise<{ success: boolean }> {
    return this.fetch(`/v1/copy/follow/${traderId}`, { method: 'DELETE' })
  }

  async getFollowing(): Promise<CopyFollow[]> {
    return this.fetch<CopyFollow[]>('/v1/copy/following')
  }

  async getCopyTrades(): Promise<CopyTrade[]> {
    return this.fetch<CopyTrade[]>('/v1/copy/trades')
  }

  // === Copy Trading (webapp API) ===

  async getTraderLeaderboard(sortBy = 'pnl7d', limit = 50): Promise<WebappTraderEntry[]> {
    const response = await this.fetch<{ traders: WebappTraderEntry[] }>(`/webapp/copy/traders?sortBy=${sortBy}&limit=${limit}`)
    return response.traders
  }

  async getTraderProfile(id: number): Promise<WebappCopyTraderProfile> {
    return this.fetch<WebappCopyTraderProfile>(`/webapp/me/copy/trader/${id}`)
  }

  async getWebappFollowing(): Promise<WebappCopyFollowingEntry[]> {
    return this.fetch<WebappCopyFollowingEntry[]>('/webapp/me/copy/following')
  }

  async getWebappCopyTrades(limit = 20, offset = 0): Promise<WebappCopyTradeRecord[]> {
    return this.fetch<WebappCopyTradeRecord[]>(`/webapp/me/copy/trades?limit=${limit}&offset=${offset}`)
  }

  async webappFollowTrader(traderId: number, settings: WebappCopyFollowSettings): Promise<unknown> {
    return this.fetch('/webapp/me/copy/follow/' + traderId, {
      method: 'POST',
      body: JSON.stringify(settings),
    })
  }

  async webappUnfollowTrader(traderId: number): Promise<void> {
    await this.fetch(`/webapp/copy/${traderId}`, { method: 'DELETE' })
  }

  async getWebappCopyFollowing(): Promise<WebappCopyFollow[]> {
    const response = await this.fetch<{ following: WebappCopyFollow[] }>('/webapp/copy/following')
    return response.following
  }

  async getCopySettings(traderId: number): Promise<WebappCopySettings> {
    const response = await this.fetch<{ settings: WebappCopySettings }>(`/webapp/copy/settings/${traderId}`)
    return response.settings
  }

  async updateCopySettings(traderId: number, settings: Partial<WebappCopySettings>): Promise<void> {
    await this.fetch(`/webapp/copy/settings/${traderId}`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  }

  async getMyTraderStats(): Promise<WebappTraderStats | null> {
    const response = await this.fetch<{ stats: WebappTraderStats | null }>('/webapp/copy/my-stats')
    return response.stats
  }

  async setTraderVisibility(isPublic: boolean, displayName?: string): Promise<void> {
    await this.fetch('/webapp/copy/visibility', {
      method: 'POST',
      body: JSON.stringify({ isPublic, displayName }),
    })
  }

  async webappFollowTraderSimple(traderId: number, params: WebappFollowTraderParams): Promise<void> {
    await this.fetch(`/webapp/copy/${traderId}`, {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  // === Points / XP (v1 API) ===

  async getMyPoints(): Promise<UserPointsInfo> {
    return this.fetch<UserPointsInfo>('/v1/points/me')
  }

  async dailyCheckin(): Promise<{ success: boolean; pointsEarned: number; streak: number }> {
    return this.fetch('/v1/points/checkin', { method: 'POST' })
  }

  async getLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
    return this.fetch<LeaderboardEntry[]>(`/v1/points/leaderboard?limit=${limit}`)
  }

  async getMilestones(): Promise<Milestone[]> {
    return this.fetch<Milestone[]>('/v1/points/milestones')
  }

  async getRewards(): Promise<Reward[]> {
    return this.fetch<Reward[]>('/v1/points/rewards')
  }

  async redeemReward(rewardId: number): Promise<{ success: boolean; message: string }> {
    return this.fetch('/v1/points/redeem', {
      method: 'POST',
      body: JSON.stringify({ rewardId }),
    })
  }

  async getPointTransactions(limit = 50): Promise<PointTransaction[]> {
    return this.fetch<PointTransaction[]>(`/v1/points/transactions?limit=${limit}`)
  }

  // === Points / XP (webapp API) ===

  async getPointsStats(): Promise<WebappPointsStats> {
    return this.fetch<WebappPointsStats>('/webapp/users/me/points/stats')
  }

  async webappDailyCheckin(): Promise<WebappCheckinResult> {
    return this.fetch<WebappCheckinResult>('/webapp/users/me/points/checkin', { method: 'POST' })
  }

  async getPointsHistory(limit = 20, offset = 0): Promise<WebappPointTransaction[]> {
    return this.fetch<WebappPointTransaction[]>(`/webapp/users/me/points/history?limit=${limit}&offset=${offset}`)
  }

  async getWebappLeaderboard(limit = 10): Promise<WebappLeaderboardEntry[]> {
    return this.fetch<WebappLeaderboardEntry[]>(`/webapp/users/me/points/leaderboard?limit=${limit}`)
  }

  async getWebappRewards(): Promise<WebappReward[]> {
    return this.fetch<WebappReward[]>('/webapp/users/me/points/rewards')
  }

  async redeemWebappReward(rewardId: number): Promise<WebappRedemptionResult> {
    return this.fetch<WebappRedemptionResult>(`/webapp/users/me/points/redeem/${rewardId}`, { method: 'POST' })
  }

  // === Referrals (v1 API) ===

  async getReferralCode(): Promise<ReferralCode> {
    return this.fetch<ReferralCode>('/v1/referral/code')
  }

  async getReferralStats(): Promise<ReferralStats> {
    return this.fetch<ReferralStats>('/v1/referral/stats')
  }

  async getReferrals(): Promise<Referral[]> {
    return this.fetch<Referral[]>('/v1/referral/list')
  }

  async applyReferralCode(code: string): Promise<{ success: boolean; message: string }> {
    return this.fetch('/v1/referral/apply', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  }

  // === Referrals (webapp API) ===

  async getWebappReferralCode(): Promise<{ referralCode: string; referralLink: string }> {
    return this.fetch('/webapp/referrals/code')
  }

  async getWebappReferralStats(): Promise<WebappReferralStats> {
    return this.fetch('/webapp/referrals/stats')
  }

  async getReferredUsers(): Promise<WebappReferredUser[]> {
    const response = await this.fetch<{ referrals: WebappReferredUser[] }>('/webapp/referrals')
    return response.referrals
  }

  // === Sniping (v1 API) ===

  async getSnipeOrders(status?: string): Promise<SnipeOrder[]> {
    const params = status ? `?status=${status}` : ''
    return this.fetch<SnipeOrder[]>(`/v1/snipe/orders${params}`)
  }

  async createSnipeOrder(request: CreateSnipeRequest): Promise<SnipeOrder> {
    return this.fetch<SnipeOrder>('/v1/snipe', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async cancelSnipeOrder(id: number): Promise<{ success: boolean }> {
    return this.fetch(`/v1/snipe/orders/${id}`, { method: 'DELETE' })
  }

  async getSnipeConfig(): Promise<SnipeConfig> {
    return this.fetch<SnipeConfig>('/v1/snipe/config')
  }

  async updateSnipeConfig(config: Partial<SnipeConfig>): Promise<SnipeConfig> {
    return this.fetch<SnipeConfig>('/v1/snipe/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  }

  async getSnipeHistory(): Promise<SnipeHistory[]> {
    return this.fetch<SnipeHistory[]>('/v1/snipe/history')
  }

  async getAutoSnipeRules(): Promise<AutoSnipeRule[]> {
    return this.fetch<AutoSnipeRule[]>('/v1/snipe/auto-rules')
  }

  async createAutoSnipeRule(rule: Omit<AutoSnipeRule, 'id' | 'triggeredCount' | 'createdAt'>): Promise<AutoSnipeRule> {
    return this.fetch<AutoSnipeRule>('/v1/snipe/auto-rules', {
      method: 'POST',
      body: JSON.stringify(rule),
    })
  }

  async deleteAutoSnipeRule(id: number): Promise<{ success: boolean }> {
    return this.fetch(`/v1/snipe/auto-rules/${id}`, { method: 'DELETE' })
  }

  async getWatchlist(): Promise<WatchedToken[]> {
    return this.fetch<WatchedToken[]>('/v1/snipe/watchlist')
  }

  async addToWatchlist(tokenAddress: string): Promise<WatchedToken> {
    return this.fetch<WatchedToken>('/v1/snipe/watchlist', {
      method: 'POST',
      body: JSON.stringify({ tokenAddress }),
    })
  }

  async removeFromWatchlist(id: number): Promise<{ success: boolean }> {
    return this.fetch(`/v1/snipe/watchlist/${id}`, { method: 'DELETE' })
  }

  // === Sniping (webapp API) ===

  async snipeToken(request: WebappSnipeRequest): Promise<WebappSnipeResult> {
    return this.fetch<WebappSnipeResult>('/webapp/snipe', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async getLaunches(chain?: string): Promise<LaunchToken[]> {
    const params = chain ? `?chain=${encodeURIComponent(chain)}` : ''
    const response = await this.fetch<{ launches: LaunchToken[] }>(`/webapp/launches${params}`)
    return response.launches
  }
}

/**
 * Concrete API client for cases where auth is injected via constructor.
 * Useful for agent API clients, tests, and server-side usage.
 */
export class SimpleApiClient extends BaseApiClient {
  private headers: Record<string, string>

  constructor(baseUrl: string, authHeaders?: Record<string, string>) {
    super(baseUrl)
    this.headers = authHeaders ?? {}
  }

  protected getAuthHeaders(): Record<string, string> {
    return this.headers
  }

  setAuthHeaders(headers: Record<string, string>): void {
    this.headers = headers
  }
}
