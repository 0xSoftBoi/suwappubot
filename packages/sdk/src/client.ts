/**
 * Suwappu — TypeScript client for the Suwappu cross-chain DEX API.
 *
 * Mirrors `packages/sdk-python/src/suwappu/client.py`. All endpoints live
 * under `/v1/agent`. Auth is `Authorization: Bearer <apiKey>`; the API key
 * falls back to the `SUWAPPU_API_KEY` environment variable.
 */

import type {
  AgentProfile,
  AgentTopupArgs,
  AgentWallet,
  Approval,
  ApprovalStatus,
  AuditEvent,
  AuditListArgs,
  AuditVerifyResult,
  KillSwitch,
  LinkCodeResult,
  SetKillSwitchArgs,
  StepUpChallenge,
  SwapHistoryResult,
  SwapSimulation,
  BillingCheckoutResult,
  BillingCryptoArgs,
  BillingInfo,
  BillingStatus,
  Chain,
  CreatePolicyArgs,
  GetQuoteArgs,
  LendingMarket,
  LendingMarketDetail,
  PerpMarket,
  PerpPosition,
  PerpQuote,
  PerpQuoteArgs,
  PredictionMarket,
  PredictionMarketDetail,
  PredictionOrder,
  PredictionOrderbook,
  PredictionOrderRequest,
  PredictionOrderResult,
  PredictionPosition,
  PredictionPrices,
  PredictionTrades,
  Quote,
  RegisterAgentArgs,
  RegisterAgentResult,
  RegisterResult,
  RotateKeysResult,
  SuwappuConfig,
  SwapResult,
  SwapStatus,
  Token,
  TokenBalance,
  TokenPrice,
  UpdateAgentArgs,
  WalletPolicy,
  WebhookEventsResult,
  WebhookTestResult,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api.suwappu.bot";

/**
 * Error thrown when the Suwappu API returns a non-2xx response.
 *
 * `code` is the machine-parseable `error_code` field from the response body
 * (e.g. `INVALID_API_KEY`, `RATE_LIMITED`), when the API returns one.
 * Undefined for older API responses or bodies that aren't JSON.
 */
export class SuwappuError extends Error {
  readonly status: number;
  readonly body: string;
  readonly code?: string;

  constructor(status: number, body: string, code?: string) {
    super(`Suwappu API error ${status}: ${body}`);
    this.name = "SuwappuError";
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

/** Alias for `SuwappuError`, kept for callers that prefer the more explicit name. */
export const SuwappuApiError = SuwappuError;

interface RequestOptions {
  params?: Record<string, string | undefined>;
  json?: unknown;
}

export class Suwappu {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  /** Hyperliquid perpetuals. */
  readonly perps: PerpsNamespace;
  /** Polymarket prediction markets. */
  readonly predict: PredictNamespace;
  /** Morpho lending markets. */
  readonly lend: LendNamespace;
  /** Agent account lifecycle, wallet policies, and webhooks. */
  readonly agent: AgentNamespace;
  /** Subscription billing (Telegram Mini App auth, not agent API key). */
  readonly billing: BillingNamespace;
  /** Human-in-the-loop approvals. Deciding requires owner auth — see the namespace docs. */
  readonly approvals: ApprovalsNamespace;
  /** Tamper-evident audit chain. */
  readonly audit: AuditNamespace;
  /** Org-wide kill switch. Requires an org API key. */
  readonly killswitch: KillSwitchNamespace;

  constructor(config: SuwappuConfig = {}) {
    this.apiKey =
      config.apiKey ??
      (typeof process !== "undefined" ? process.env?.SUWAPPU_API_KEY : undefined) ??
      "";
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

    this.perps = new PerpsNamespace(this);
    this.predict = new PredictNamespace(this);
    this.lend = new LendNamespace(this);
    this.agent = new AgentNamespace(this);
    this.billing = new BillingNamespace(this);
    this.approvals = new ApprovalsNamespace(this);
    this.audit = new AuditNamespace(this);
    this.killswitch = new KillSwitchNamespace(this);
  }

  /** @internal Low-level request helper used by the client and namespaces. */
  async _request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (options.params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) search.set(key, value);
      }
      const qs = search.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(url, {
      method,
      headers,
      ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let code: string | undefined;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.error_code === "string") code = parsed.error_code;
      } catch {
        // body wasn't JSON (or had no error_code) — leave code undefined
      }
      throw new SuwappuError(res.status, text, code);
    }

    return (await res.json()) as T;
  }

  // --- Swap ---

  /**
   * Get a swap quote. Object-arg form matching the showcase:
   *   client.getQuote({ from: 'USDC', to: 'ETH', chain: 'base', amount: '1000' })
   * For a cross-chain quote pass fromChain/toChain instead of (or in addition
   * to) chain — they map directly to the API's from_chain/to_chain fields.
   */
  async getQuote(args: GetQuoteArgs): Promise<Quote> {
    const data = await this._request<Record<string, any>>("POST", "/v1/agent/quote", {
      json: {
        from_token: args.from,
        to_token: args.to,
        amount: String(args.amount),
        chain: args.chain,
        from_chain: args.fromChain,
        to_chain: args.toChain,
        wallet_address: args.walletAddress,
        slippage: args.slippage,
      },
    });
    return {
      id: String(data.quote_id ?? data.id ?? ""),
      fromToken: data.from_token?.symbol ?? data.fromToken ?? args.from,
      toToken: data.to_token?.symbol ?? data.toToken ?? args.to,
      fromAmount: String(data.amount_in ?? data.fromAmount ?? args.amount),
      toAmount: String(data.amount_out ?? data.toAmount ?? "0"),
      amountOutMin: String(data.amount_out_min ?? data.amountOutMin ?? "0"),
      route: String(data.route ?? ""),
      gas: String(data.estimated_gas_usd ?? data.gas ?? "0"),
      fee: String(data.bridge_fee_usd ?? data.fee ?? "0"),
      chain: String(data.from_chain ?? data.chain ?? args.fromChain ?? args.chain ?? ""),
      exchangeRate: String(data.exchange_rate ?? "0"),
      priceImpact: String(data.price_impact ?? "0"),
      slippage: String(data.slippage ?? "0"),
      estimatedTimeSeconds: Number(data.estimated_time_seconds ?? 0),
      expiresInSeconds: Number(data.expires_in_seconds ?? 0),
      dex: String(data.dex ?? ""),
    };
  }

  /**
   * Execute a previously obtained quote via the server-managed wallet pipeline.
   * This is the explicit managed-custody method for new code.
   *
   * Hits POST /v1/agent/swap/execute and returns a managed swap record
   * ({ swap_id, status, tx_hash, tracking }). It is NOT the self-custody
   * unsigned-transaction path; use prepareSwap() for that.
   */
  async executeManagedSwap(quoteOrId: Quote | string): Promise<SwapResult> {
    const quoteId = typeof quoteOrId === "string" ? quoteOrId : quoteOrId.id;
    const data = await this._request<Record<string, any>>("POST", "/v1/agent/swap/execute", {
      json: { quote_id: quoteId },
    });
    if (data.swap_id === undefined || data.status === undefined) {
      throw new SuwappuError(
        200,
        `Malformed swap response from /v1/agent/swap/execute: ${JSON.stringify(data)}`,
      );
    }
    return {
      swapId: data.swap_id,
      txHash: data.tx_hash ?? null,
      status: data.status,
      pollUrl: data.tracking?.poll_url,
    };
  }

  /**
   * Backwards-compatible managed-execution alias.
   *
   * Prefer executeManagedSwap() in new code so the custody boundary is visible
   * at the call site. walletAddress is retained only for older callers; the
   * managed route resolves the authenticated agent wallet server-side.
   */
  swap(quoteOrId: Quote | string, walletAddress?: string): Promise<SwapResult> {
    void walletAddress;
    return this.executeManagedSwap(quoteOrId);
  }

  /** Backwards-compatible alias for managed execution. */
  executeSwap(quoteId: string, walletAddress?: string): Promise<SwapResult> {
    void walletAddress;
    return this.executeManagedSwap(quoteId);
  }

  /**
   * Build an unsigned swap transaction from a previously obtained quote id.
   * Mirrors POST /v1/agent/swap exactly and returns the raw API payload
   * (status, swap summary, unsigned transaction, human instructions) instead
   * of the slimmed-down SwapResult shape — this is what the CLI's `swap`
   * command prints. This self-custody path never signs or broadcasts;
   * the caller signs the returned transaction with their own wallet.
   */
  async prepareSwap(args: { quoteId: string; walletAddress: string }): Promise<Record<string, unknown>> {
    return this._request<Record<string, unknown>>("POST", "/v1/agent/swap", {
      json: { quote_id: args.quoteId, wallet_address: args.walletAddress },
    });
  }

  /** GET /v1/agent/swap/status/:swapId */
  /**
   * POST /v1/agent/swap/simulate — dry-run a swap without broadcasting.
   *
   * Use this before {@link executeManagedSwap} on unfamiliar routes: it surfaces reverts and
   * gas cost while nothing is at stake.
   */
  async simulateSwap(args: { quoteId: string; walletAddress: string }): Promise<SwapSimulation> {
    return this._request<SwapSimulation>("POST", "/v1/agent/swap/simulate", {
      json: { quote_id: args.quoteId, wallet_address: args.walletAddress },
    });
  }

  /** GET /v1/agent/swaps — this agent's swap history, newest first. */
  async listSwaps(
    args: { status?: string; limit?: number; offset?: number } = {},
  ): Promise<SwapHistoryResult> {
    const data = await this._request<Record<string, any>>("GET", "/v1/agent/swaps", {
      params: {
        status: args.status,
        limit: args.limit?.toString(),
        offset: args.offset?.toString(),
      },
    });
    return {
      swaps: (data.swaps ?? []).map((s: Record<string, any>) => ({
        id: s.id,
        status: s.status,
        fromToken: s.from_token ?? s.fromToken,
        toToken: s.to_token ?? s.toToken,
        fromAmount: s.from_amount ?? s.fromAmount,
        toAmount: s.to_amount ?? s.toAmount,
        chain: s.chain,
        txHash: s.tx_hash ?? s.txHash ?? null,
        createdAt: s.created_at ?? s.createdAt,
      })),
      pagination: {
        total: data.pagination?.total ?? 0,
        limit: data.pagination?.limit ?? args.limit ?? 20,
        offset: data.pagination?.offset ?? args.offset ?? 0,
        hasMore: data.pagination?.has_more ?? false,
      },
    };
  }

  async getSwapStatus(swapId: string | number): Promise<SwapStatus> {
    const data = await this._request<Record<string, any>>(
      "GET",
      `/v1/agent/swap/status/${swapId}`,
    );
    return {
      swapId: Number(data.swap_id),
      status: String(data.status ?? ""),
      txHash: data.tx_hash ?? null,
      fromChain: String(data.from_chain ?? ""),
      toChain: String(data.to_chain ?? ""),
      fromToken: String(data.from_token ?? ""),
      toToken: String(data.to_token ?? ""),
      fromAmount: String(data.from_amount ?? ""),
      toAmount: String(data.to_amount ?? ""),
      errorMessage: data.error_message ?? null,
      createdAt: String(data.created_at ?? ""),
      completedAt: data.completed_at ?? null,
    };
  }

  // --- Agent account ---

  /**
   * Self-serve register a new agent. POST /v1/agent/register (public, no
   * auth required). The returned apiKey is shown exactly once — the API
   * never re-exposes it.
   */
  async register(args: RegisterAgentArgs): Promise<RegisterResult> {
    const data = await this._request<Record<string, any>>("POST", "/v1/agent/register", {
      json: {
        name: args.name,
        description: args.description,
        callback_url: args.callbackUrl,
      },
    });
    const agent = data.agent ?? {};
    return {
      id: String(agent.id ?? ""),
      name: String(agent.name ?? args.name),
      apiKey: String(agent.api_key ?? ""),
      createdAt: String(agent.created_at ?? ""),
    };
  }

  /** GET /v1/agent/me. Alias for `agent.getMe()`. */
  async me(): Promise<AgentProfile> {
    const data = await this._request<{ agent: Record<string, any> }>("GET", "/v1/agent/me");
    return toAgentProfile(data.agent ?? {});
  }

  /** GET /v1/agent/billing — credit balance, tier, metering + topup/subscribe info. */
  async getBilling(): Promise<BillingInfo> {
    const data = await this._request<Record<string, any>>("GET", "/v1/agent/billing");
    return {
      agentId: String(data.agent_id ?? ""),
      tier: String(data.tier ?? "free"),
      meteringEnabled: Boolean(data.metering_enabled),
      bypassTiers: data.bypass_tiers ?? [],
      isMetered: Boolean(data.is_metered),
      credits: {
        balance: Number(data.credits?.balance ?? 0),
        lifetimePurchased: Number(data.credits?.lifetime_purchased ?? 0),
        lifetimeUsed: Number(data.credits?.lifetime_used ?? 0),
      },
      creditUsdValue: Number(data.credit_usd_value ?? 0),
      costWeights: data.cost_weights ?? {},
      topup: {
        endpoint: String(data.topup?.endpoint ?? "POST /v1/agent/billing/topup"),
        note: String(data.topup?.note ?? ""),
      },
      subscribe: {
        endpoint: String(data.subscribe?.endpoint ?? "POST /v1/agent/billing/subscribe"),
        tierPricesUsd: data.subscribe?.tier_prices_usd ?? {},
        periodDays: Number(data.subscribe?.period_days ?? 0),
        active: data.subscribe?.active ?? null,
      },
    };
  }

  async getPortfolio(walletAddress: string, chain?: string): Promise<TokenBalance[]> {
    const data = await this._request<{ balances?: any[] }>("GET", "/v1/agent/portfolio", {
      params: { wallet_address: walletAddress, chain },
    });
    return (data.balances ?? []).map((b) => ({
      token: b.symbol ?? b.token ?? "",
      balance: String(b.balance ?? ""),
      usdValue: String(b.usd_value ?? b.usdValue ?? ""),
      chain: b.chain ?? "",
    }));
  }

  async getPrices(symbols: string, chain?: string): Promise<TokenPrice[]> {
    const data = await this._request<{ prices?: Record<string, any> }>(
      "GET",
      "/v1/agent/prices",
      { params: { symbols, chain } },
    );
    return Object.entries(data.prices ?? {}).map(([token, info]) => ({
      token,
      priceUsd: String(info?.usd ?? ""),
      change24h: String(info?.change_24h ?? 0),
    }));
  }

  async listChains(): Promise<Chain[]> {
    const data = await this._request<{ chains?: Chain[] }>("GET", "/v1/agent/chains");
    return data.chains ?? [];
  }

  async listTokens(chain: string, search?: string): Promise<Token[]> {
    const data = await this._request<{ tokens?: Token[] } | Token[]>("GET", "/v1/agent/tokens", {
      params: { chain, search },
    });
    if (Array.isArray(data)) return data;
    return data.tokens ?? [];
  }

  // --- Billing ---
  // Note: /billing/* endpoints authenticate via Telegram Mini App auth
  // (telegramAuth), not the agent API key. They're included for SDK
  // completeness but aren't callable with only an agent apiKey.

  /** GET /billing/stripe/checkout?tier=... (always requests JSON, not the redirect). */
  async billingCheckout(tier: "pro" | "premium"): Promise<BillingCheckoutResult> {
    return this.billing.checkout(tier);
  }

  /** POST /billing/crypto — submit a crypto payment proof for a subscription tier. */
  async billingCrypto(args: BillingCryptoArgs): Promise<Record<string, unknown>> {
    return this.billing.payCrypto(args);
  }

  /** GET /billing/status — current subscription tier and fee rate. */
  async billingStatus(): Promise<BillingStatus> {
    return this.billing.status();
  }
}

class BillingNamespace {
  constructor(private readonly c: Suwappu) {}

  /** GET /billing/stripe/checkout?tier=...&format=json (always requests JSON, not the redirect). */
  async checkout(tier: "pro" | "premium"): Promise<BillingCheckoutResult> {
    return this.c._request<BillingCheckoutResult>("GET", "/billing/stripe/checkout", {
      params: { tier, format: "json" },
    });
  }

  /** POST /billing/crypto — submit a crypto payment proof for a subscription tier. */
  async payCrypto(args: BillingCryptoArgs): Promise<Record<string, unknown>> {
    return this.c._request("POST", "/billing/crypto", {
      json: { txHash: args.txHash, chain: args.chain, amount: args.amount, tier: args.tier },
    });
  }

  /** GET /billing/status — current subscription tier and fee rate. */
  async status(): Promise<BillingStatus> {
    const data = await this.c._request<Record<string, any>>("GET", "/billing/status");
    return {
      tier: data.tier,
      feeRatePercent: data.fee_rate_percent,
      expiresAt: data.expires_at ?? null,
      active: Boolean(data.active),
    };
  }
}

class PerpsNamespace {
  constructor(private readonly c: Suwappu) {}

  /** GET /v1/agent/perps/markets */
  async markets(): Promise<PerpMarket[]> {
    const data = await this.c._request<{ markets?: PerpMarket[] }>(
      "GET",
      "/v1/agent/perps/markets",
    );
    return data.markets ?? [];
  }

  /** POST /v1/agent/perps/quote */
  async quote(args: PerpQuoteArgs): Promise<PerpQuote> {
    return this.c._request<PerpQuote>("POST", "/v1/agent/perps/quote", {
      json: {
        market: args.market,
        side: args.side,
        size: args.size,
        leverage: args.leverage,
      },
    });
  }

  /** GET /v1/agent/perps/positions */
  async positions(address: string): Promise<PerpPosition[]> {
    const data = await this.c._request<{ positions?: PerpPosition[] }>(
      "GET",
      "/v1/agent/perps/positions",
      { params: { address } },
    );
    return data.positions ?? [];
  }
}

class PredictNamespace {
  constructor(private readonly c: Suwappu) {}

  /**
   * List prediction markets. The showcase calls this `client.predict.list(...)`;
   * exposed under both `list` and `markets` for ergonomics.
   * GET /v1/agent/predict/markets
   */
  async list(args: { query?: string; limit?: number } = {}): Promise<PredictionMarket[]> {
    const data = await this.c._request<{ markets?: PredictionMarket[] }>(
      "GET",
      "/v1/agent/predict/markets",
      { params: { query: args.query, limit: args.limit?.toString() } },
    );
    return data.markets ?? [];
  }

  /** Alias for list(), mirroring the Python client's predict.markets. */
  markets(args: { query?: string; limit?: number } = {}): Promise<PredictionMarket[]> {
    return this.list(args);
  }

  /** GET /v1/agent/predict/market/:id */
  market(id: string): Promise<PredictionMarketDetail> {
    return this.c._request<PredictionMarketDetail>("GET", `/v1/agent/predict/market/${id}`);
  }

  /** GET /v1/agent/predict/market/:id/book */
  book(id: string): Promise<PredictionOrderbook> {
    return this.c._request<PredictionOrderbook>("GET", `/v1/agent/predict/market/${id}/book`);
  }

  /** GET /v1/agent/predict/market/:id/price */
  price(id: string): Promise<PredictionPrices> {
    return this.c._request<PredictionPrices>("GET", `/v1/agent/predict/market/${id}/price`);
  }

  /** GET /v1/agent/predict/market/:id/trades */
  trades(id: string, limit?: number): Promise<PredictionTrades> {
    return this.c._request<PredictionTrades>("GET", `/v1/agent/predict/market/${id}/trades`, {
      params: { limit: limit?.toString() },
    });
  }

  /**
   * Place a CLOB order. POST /v1/agent/predict/order
   *
   * The showcase shows `predict.buy({ marketId, outcome, amount })`, but the
   * real endpoint takes a token id + limit price + side (PlaceOrderSchema).
   * `order()` is the faithful wrapper; `buy()` is intentionally NOT provided
   * because the illustrative `{ marketId, outcome, amount }` shape has no
   * direct backing endpoint (no market-order-by-outcome route exists).
   */
  async order(req: PredictionOrderRequest): Promise<PredictionOrderResult> {
    const data = await this.c._request<{ order?: PredictionOrderResult }>(
      "POST",
      "/v1/agent/predict/order",
      { json: req },
    );
    return data.order ?? {};
  }

  /** GET /v1/agent/predict/positions */
  async positions(): Promise<PredictionPosition[]> {
    const data = await this.c._request<{ positions?: PredictionPosition[] }>(
      "GET",
      "/v1/agent/predict/positions",
    );
    return data.positions ?? [];
  }

  /** GET /v1/agent/predict/orders */
  async orders(status?: string): Promise<PredictionOrder[]> {
    const data = await this.c._request<{ orders?: PredictionOrder[] } | PredictionOrder[]>(
      "GET",
      "/v1/agent/predict/orders",
      { params: { status } },
    );
    if (Array.isArray(data)) return data;
    return data.orders ?? [];
  }

  /** GET /v1/agent/predict/events — search/browse prediction events */
  async events(args: { query?: string; limit?: number } = {}): Promise<Record<string, unknown>[]> {
    const data = await this.c._request<{ events?: Record<string, unknown>[] }>(
      "GET",
      "/v1/agent/predict/events",
      { params: { query: args.query, limit: args.limit?.toString() } },
    );
    return data.events ?? [];
  }

  /** DELETE /v1/agent/predict/order/:id — cancel a resting order */
  cancelOrder(id: string): Promise<Record<string, unknown>> {
    return this.c._request("DELETE", `/v1/agent/predict/order/${id}`);
  }
}

class LendNamespace {
  constructor(private readonly c: Suwappu) {}

  /** GET /v1/agent/lend/markets */
  async markets(chainId?: number): Promise<LendingMarket[]> {
    const data = await this.c._request<{ markets?: LendingMarket[] }>(
      "GET",
      "/v1/agent/lend/markets",
      { params: { chainId: chainId?.toString() } },
    );
    return data.markets ?? [];
  }

  /** GET /v1/agent/lend/market/:id */
  market(id: string): Promise<LendingMarketDetail> {
    return this.c._request<LendingMarketDetail>("GET", `/v1/agent/lend/market/${id}`);
  }
}

function toAgentProfile(a: Record<string, any>): AgentProfile {
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? null,
    callbackUrl: a.callback_url ?? null,
    metadata: a.metadata ?? null,
    rateLimitTier: a.rate_limit_tier,
    stats: a.stats
      ? { totalRequests: a.stats.total_requests, totalSwaps: a.stats.total_swaps }
      : undefined,
    createdAt: a.created_at,
    lastActiveAt: a.last_active_at ?? null,
    updatedAt: a.updated_at,
  };
}

class AgentNamespace {
  constructor(private readonly c: Suwappu) {}

  /** POST /v1/agent/register (public, no auth required) */
  async register(args: RegisterAgentArgs): Promise<RegisterAgentResult> {
    const data = await this.c._request<Record<string, any>>("POST", "/v1/agent/register", {
      json: {
        name: args.name,
        description: args.description,
        callback_url: args.callbackUrl,
        metadata: args.metadata,
      },
    });
    return {
      agent: { ...toAgentProfile(data.agent), apiKey: data.agent.api_key },
      message: data.message,
      important: data.important,
    };
  }

  /** GET /v1/agent/me */
  async getMe(): Promise<AgentProfile> {
    const data = await this.c._request<{ agent: Record<string, any> }>("GET", "/v1/agent/me");
    return toAgentProfile(data.agent);
  }

  /** PATCH /v1/agent/me */
  async updateMe(args: UpdateAgentArgs): Promise<AgentProfile> {
    const data = await this.c._request<{ agent: Record<string, any> }>("PATCH", "/v1/agent/me", {
      json: {
        description: args.description,
        callback_url: args.callbackUrl,
        metadata: args.metadata,
      },
    });
    return toAgentProfile(data.agent);
  }

  /** POST /v1/agent/me/deactivate */
  async deactivate(): Promise<{ success: boolean; message: string }> {
    return this.c._request("POST", "/v1/agent/me/deactivate");
  }

  /** POST /v1/agent/reactivate (works even when the agent is inactive) */
  async reactivate(): Promise<{ success: boolean; message: string }> {
    return this.c._request("POST", "/v1/agent/reactivate");
  }

  /** POST /v1/agent/keys/rotate — old key is invalidated immediately. */
  async rotateKeys(): Promise<RotateKeysResult> {
    const data = await this.c._request<{ api_key: string; message: string }>(
      "POST",
      "/v1/agent/keys/rotate",
    );
    return { apiKey: data.api_key, message: data.message };
  }

  /** POST /v1/agent/billing/topup — credit the agent's balance from an on-chain USDC payment. */
  async topup(args: AgentTopupArgs): Promise<Record<string, unknown>> {
    return this.c._request("POST", "/v1/agent/billing/topup", {
      json: { txHash: args.txHash, chain: args.chain, amount: args.amount },
    });
  }

  /** POST /v1/agent/wallet/policy */
  async createPolicy(args: CreatePolicyArgs): Promise<WalletPolicy> {
    const data = await this.c._request<{ policy: WalletPolicy }>(
      "POST",
      "/v1/agent/wallet/policy",
      { json: args },
    );
    return data.policy;
  }

  /** GET /v1/agent/wallet/policies */
  async listPolicies(): Promise<WalletPolicy[]> {
    const data = await this.c._request<{ policies: WalletPolicy[] }>(
      "GET",
      "/v1/agent/wallet/policies",
    );
    return data.policies ?? [];
  }

  /** DELETE /v1/agent/wallet/policy/:policyId */
  async deletePolicy(policyId: string): Promise<{ success: boolean; deleted: boolean }> {
    return this.c._request("DELETE", `/v1/agent/wallet/policy/${policyId}`);
  }

  /**
   * POST /v1/agent/wallets — provision a managed wallet for this agent.
   *
   * Idempotent per agent: an agent that already has a wallet gets that one back.
   */
  async createWallet(): Promise<AgentWallet> {
    const data = await this.c._request<{ wallet?: AgentWallet } & AgentWallet>(
      "POST",
      "/v1/agent/wallets",
    );
    return data.wallet ?? (data as AgentWallet);
  }

  /** GET /v1/agent/wallets — empty until {@link createWallet} has been called. */
  async listWallets(): Promise<AgentWallet[]> {
    const data = await this.c._request<{ wallets?: AgentWallet[] }>("GET", "/v1/agent/wallets");
    return data.wallets ?? [];
  }

  /**
   * POST /v1/agent/link/code — mint a short-lived code the human owner redeems
   * to link this agent to their account. Fails with 409 if already linked.
   */
  async linkCode(): Promise<LinkCodeResult> {
    const data = await this.c._request<Record<string, any>>("POST", "/v1/agent/link/code");
    return { code: data.code, expiresAt: data.expires_at ?? data.expiresAt };
  }

  /** GET /v1/agent/webhooks */
  async listWebhooks(args: { status?: string; eventType?: string; limit?: number; offset?: number } = {}): Promise<WebhookEventsResult> {
    const data = await this.c._request<Record<string, any>>("GET", "/v1/agent/webhooks", {
      params: {
        status: args.status,
        event_type: args.eventType,
        limit: args.limit?.toString(),
        offset: args.offset?.toString(),
      },
    });
    return {
      events: (data.events ?? []).map((e: Record<string, any>) => ({
        id: e.id,
        eventType: e.event_type,
        status: e.status,
        attempts: e.attempts,
        lastError: e.last_error ?? null,
        responseStatus: e.response_status ?? null,
        callbackUrl: e.callback_url,
        createdAt: e.created_at,
        deliveredAt: e.delivered_at ?? null,
      })),
      pagination: {
        total: data.pagination.total,
        limit: data.pagination.limit,
        offset: data.pagination.offset,
        hasMore: data.pagination.has_more,
      },
    };
  }

  /** POST /v1/agent/webhooks/test — sends a signed test payload to callback_url. */
  async testWebhook(): Promise<WebhookTestResult> {
    const data = await this.c._request<Record<string, any>>("POST", "/v1/agent/webhooks/test");
    return {
      success: data.success,
      callbackUrl: data.callback_url,
      statusCode: data.status_code,
      responseTimeMs: data.response_time_ms,
      error: data.error,
    };
  }
}

/**
 * Human-in-the-loop approvals.
 *
 * Auth note: listing and deciding approvals is an *owner* action and
 * authenticates as the linked human (Mini App / owner JWT), not as the agent
 * API key. Only `get()` accepts a plain agent key. Pass the owner token as
 * `apiKey` on a separate client if you are driving the owner side.
 */
export class ApprovalsNamespace {
  constructor(private readonly c: Suwappu) {}

  /** GET /v1/agent/approvals — owner auth. */
  async list(args: { status?: ApprovalStatus } = {}): Promise<Approval[]> {
    const data = await this.c._request<{ approvals?: Approval[] }>(
      "GET",
      "/v1/agent/approvals",
      { params: { status: args.status } },
    );
    return data.approvals ?? [];
  }

  /** GET /v1/agent/approvals/:id — readable with the agent's own API key. */
  async get(id: string): Promise<Approval> {
    const data = await this.c._request<{ approval?: Approval } & Approval>(
      "GET",
      `/v1/agent/approvals/${encodeURIComponent(id)}`,
    );
    return data.approval ?? (data as Approval);
  }

  /**
   * POST /v1/agent/approvals/:id/approve — owner auth.
   *
   * When the deployment sets APPROVAL_STEP_UP_REQUIRED=true, obtain a
   * challenge via {@link stepUpChallenge} first and pass it as `stepUpChallenge`.
   */
  async approve(id: string, args: { stepUpChallenge?: string } = {}): Promise<Approval> {
    const data = await this.c._request<{ approval?: Approval } & Approval>(
      "POST",
      `/v1/agent/approvals/${encodeURIComponent(id)}/approve`,
      { json: { step_up_challenge: args.stepUpChallenge } },
    );
    return data.approval ?? (data as Approval);
  }

  /** POST /v1/agent/approvals/:id/deny — owner auth. */
  async deny(id: string): Promise<Approval> {
    const data = await this.c._request<{ approval?: Approval } & Approval>(
      "POST",
      `/v1/agent/approvals/${encodeURIComponent(id)}/deny`,
    );
    return data.approval ?? (data as Approval);
  }

  /** POST /v1/agent/approvals/:id/step-up/challenge — owner auth. */
  async stepUpChallenge(id: string): Promise<StepUpChallenge> {
    return this.c._request<StepUpChallenge>(
      "POST",
      `/v1/agent/approvals/${encodeURIComponent(id)}/step-up/challenge`,
    );
  }
}

/** Tamper-evident audit chain. */
export class AuditNamespace {
  constructor(private readonly c: Suwappu) {}

  /** GET /v1/agent/audit — scoped to your org (org key) or your agent (agent key). */
  async list(args: AuditListArgs = {}): Promise<AuditEvent[]> {
    const data = await this.c._request<{ events?: Record<string, any>[] }>(
      "GET",
      "/v1/agent/audit",
      {
        params: {
          event_type: args.eventType,
          agent_id: args.agentId,
          since: args.since,
          limit: args.limit?.toString(),
        },
      },
    );
    return (data.events ?? []).map((e) => ({
      id: e.id,
      eventType: e.event_type ?? e.eventType,
      agentId: e.agent_id ?? e.agentId ?? null,
      orgId: e.org_id ?? e.orgId ?? null,
      details: e.details,
      createdAt: e.created_at ?? e.createdAt,
    }));
  }

  /**
   * GET /v1/agent/audit/verify — recompute the hash chain.
   *
   * Requires an **org** API key. Chain verification is inherently whole-chain,
   * and org-less agents share one global chain, so the API refuses this for
   * plain agent tokens rather than leaking other tenants' rows.
   */
  async verify(): Promise<AuditVerifyResult> {
    return this.c._request<AuditVerifyResult>("GET", "/v1/agent/audit/verify");
  }
}

/** Org-wide kill switch. Requires an org API key. */
export class KillSwitchNamespace {
  constructor(private readonly c: Suwappu) {}

  /** GET /v1/agent/killswitch */
  async list(): Promise<KillSwitch[]> {
    const data = await this.c._request<{ killswitches?: Record<string, any>[] }>(
      "GET",
      "/v1/agent/killswitch",
    );
    return (data.killswitches ?? []).map((k) => ({
      scope: k.scope,
      scopeId: k.scope_id ?? k.scopeId ?? null,
      active: k.active,
      reason: k.reason ?? null,
    }));
  }

  /** POST /v1/agent/killswitch — halts execution for the given scope. */
  async set(args: SetKillSwitchArgs): Promise<KillSwitch> {
    const data = await this.c._request<Record<string, any>>("POST", "/v1/agent/killswitch", {
      json: { scope: args.scope, active: args.active, reason: args.reason },
    });
    return {
      scope: data.scope ?? args.scope,
      scopeId: data.scope_id ?? null,
      active: data.active ?? args.active,
      reason: data.reason ?? args.reason ?? null,
    };
  }
}

/** Create a Suwappu client. */
export function createClient(config: SuwappuConfig = {}): Suwappu {
  return new Suwappu(config);
}
