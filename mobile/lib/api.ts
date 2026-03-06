/**
 * Suwappu API client for React Native.
 *
 * Extends the shared BaseApiClient with:
 * - JWT auth headers from expo-secure-store (via auth.ts memory cache)
 * - 401 interception that fires authEvents so AuthContext can redirect
 * - Adapter methods that bridge hook expectations to BaseApiClient methods
 * - Mobile-specific endpoints (discovery, token price, wallet creation)
 */
import { BaseApiClient } from '../../packages/shared/src/api/client'
import { getAuthToken } from './auth'
import { authEvents } from './authEvents'
import type { DiscoveryToken } from '../hooks/useTokenDiscovery'
import type { TokenPriceData, Timeframe } from '../hooks/useTokenPrice'
import type { PriceAlert } from '../../packages/shared/src/types/alerts'
import type { DCAOrder, CreateDCARequest, DCAExecution } from '../../packages/shared/src/types/orders'
import type { TraderProfile, CopyFollow, CopyTrade } from '../../packages/shared/src/types/copy-trading'
import type { UserPointsInfo, PointTransaction } from '../../packages/shared/src/types/points'
import type { Referral, ReferralReward } from '../../packages/shared/src/types/referral'
import type { LinkedWallet } from '../../packages/shared/src/types/auth'

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://api.suwappu.bot'

class MobileApiClient extends BaseApiClient {
  constructor(baseUrl: string) {
    super(baseUrl)
  }

  // ── Auth header injection ──────────────────────────────────

  protected getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}

    const token = getAuthToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    // Dev mode fallback
    const isDev = this.baseUrl.includes('devapi') || this.baseUrl.includes('localhost')
    if (isDev) {
      headers['X-Dev-User-Id'] = '12345'
    }

    return headers
  }

  // ── Override fetch to intercept 401 ────────────────────────

  protected override async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    try {
      return await super.fetch<T>(endpoint, options)
    } catch (error: any) {
      if (error?.status === 401) {
        authEvents.emit('unauthorized')
      }
      throw error
    }
  }

  // ── Alert adapters ─────────────────────────────────────────

  async toggleAlert(id: number): Promise<PriceAlert> {
    return this.fetch<PriceAlert>(`/v1/alerts/${id}/toggle`, { method: 'PUT' })
  }

  // ── Copy Trading adapters ──────────────────────────────────

  async getTraderLeaderboard(limit = 50): Promise<TraderProfile[]> {
    return this.getTraders('rank_score', limit)
  }

  async getTraderProfile(traderId: number): Promise<TraderProfile> {
    return this.getTrader(traderId)
  }

  async getMyFollows(): Promise<CopyFollow[]> {
    return this.getFollowing()
  }

  override async getCopyTrades(_limit?: number): Promise<CopyTrade[]> {
    return super.getCopyTrades()
  }

  // ── DCA adapters ───────────────────────────────────────────

  async getDCAPlans(): Promise<DCAOrder[]> {
    return this.getDCAOrders()
  }

  async createDCA(data: CreateDCARequest): Promise<DCAOrder> {
    return this.createDCAOrder(data)
  }

  override async getDCAExecutions(dcaId: number): Promise<DCAExecution[]> {
    return super.getDCAExecutions(dcaId)
  }

  // ── Points adapters ────────────────────────────────────────

  async getPoints(): Promise<UserPointsInfo> {
    return this.getMyPoints()
  }

  async getPointsHistory(limit = 50, _offset = 0): Promise<PointTransaction[]> {
    return this.getPointTransactions(limit)
  }

  // ── Referral adapters ──────────────────────────────────────

  async getReferralList(): Promise<Referral[]> {
    return this.getReferrals()
  }

  async getReferralRewards(): Promise<ReferralReward[]> {
    return this.fetch<ReferralReward[]>('/v1/referral/rewards')
  }

  // ── Wallet adapters ────────────────────────────────────────

  async createWallet(chainType: string): Promise<LinkedWallet> {
    return this.fetch<LinkedWallet>('/v1/wallets', {
      method: 'POST',
      body: JSON.stringify({ chainType }),
    })
  }

  async setDefaultWallet(address: string): Promise<LinkedWallet> {
    return this.fetch<LinkedWallet>(`/v1/wallets/${encodeURIComponent(address)}/default`, {
      method: 'PUT',
    })
  }

  // ── Token Discovery ────────────────────────────────────────

  async getDiscoverTrending(chain = 'all', limit = 50): Promise<DiscoveryToken[]> {
    const params = new URLSearchParams({ chain, limit: String(limit) })
    return this.fetch<DiscoveryToken[]>(`/v1/discover/trending?${params}`)
  }

  async getDiscoverGainers(timeframe = '24h'): Promise<DiscoveryToken[]> {
    return this.fetch<DiscoveryToken[]>(`/v1/discover/gainers?timeframe=${timeframe}`)
  }

  async getDiscoverNew(chain = 'all'): Promise<DiscoveryToken[]> {
    return this.fetch<DiscoveryToken[]>(`/v1/discover/new?chain=${chain}`)
  }

  async getDiscoverSearch(query: string): Promise<DiscoveryToken[]> {
    return this.fetch<DiscoveryToken[]>(`/v1/discover/search?q=${encodeURIComponent(query)}`)
  }

  // ── Token Price ────────────────────────────────────────────

  async getTokenPrice(chain: string, address: string, timeframe: Timeframe = '1d'): Promise<TokenPriceData> {
    const params = new URLSearchParams({ chain, address, timeframe })
    return this.fetch<TokenPriceData>(`/v1/tokens/price?${params}`)
  }
}

export const api = new MobileApiClient(API_BASE)
