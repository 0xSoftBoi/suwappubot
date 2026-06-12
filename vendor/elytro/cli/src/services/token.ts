import type { FileStore } from '../storage';

/**
 * TokenService — fetch and cache token lists from the Uniswap default-token-list.
 *
 * Data source:
 *   Per-chain JSON files from https://github.com/Uniswap/default-token-list
 *   Raw URL pattern: https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/<chain>.json
 *
 * Caching:
 *   Fetched lists are cached to ~/.elytro/cache/tokens-<chainId>.json via FileStore.
 *   Cache TTL defaults to 24 hours. On fetch failure, stale cache is returned if available.
 *
 * The service does NOT store a static copy of token data — it always tries
 * to fetch the latest list, falling back to cache on network errors.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface TokenEntry {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
}

interface CachedTokenList {
  fetchedAt: number;
  tokens: TokenEntry[];
}

// ─── Constants ───────────────────────────────────────────────────────

const NATIVE_ETH: Omit<TokenEntry, 'chainId'> = {
  address: '0x0000000000000000000000000000000000000000',
  name: 'Ether',
  symbol: 'ETH',
  decimals: 18,
};

/**
 * GitHub raw URL slug per chain ID.
 * Must match file names under Uniswap/default-token-list/src/tokens/.
 */
const CHAIN_SLUG: Record<number, string> = {
  1: 'mainnet',
  10: 'optimism',
  137: 'polygon',
  42161: 'arbitrum',
  8453: 'base',
};

/** How long cached data is considered fresh (milliseconds). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const BASE_URL = 'https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens';

// ─── Service ─────────────────────────────────────────────────────────

export class TokenService {
  private store: FileStore;
  /** In-memory cache to avoid re-reading disk within a single CLI invocation. */
  private memoryCache: Map<number, TokenEntry[]> = new Map();

  constructor(store: FileStore) {
    this.store = store;
  }

  /**
   * Get the token list for a chain.
   *
   * Resolution order:
   *   1. In-memory cache (same CLI invocation)
   *   2. Fetch from GitHub (if cache missing or stale)
   *   3. Disk cache (if fetch fails)
   *   4. Empty array (if all fail)
   */
  async getTokens(chainId: number): Promise<TokenEntry[]> {
    // 1. Memory cache
    if (this.memoryCache.has(chainId)) {
      return this.memoryCache.get(chainId)!;
    }

    const cacheKey = `cache/tokens-${chainId}`;

    // 2. Check disk cache freshness
    const cached = await this.store.load<CachedTokenList>(cacheKey);
    const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

    if (isFresh) {
      this.memoryCache.set(chainId, cached!.tokens);
      return cached!.tokens;
    }

    // 3. Fetch from GitHub
    const slug = CHAIN_SLUG[chainId];
    if (!slug) {
      // Unsupported chain — no remote source available
      return cached?.tokens ?? [];
    }

    try {
      const url = `${BASE_URL}/${slug}.json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const raw = (await res.json()) as Array<Record<string, unknown>>;
      const tokens = this.parseAndPrepend(raw, chainId);

      // Persist to disk cache
      await this.store.save<CachedTokenList>(cacheKey, {
        fetchedAt: Date.now(),
        tokens,
      });

      this.memoryCache.set(chainId, tokens);
      return tokens;
    } catch {
      // 4. Fall back to stale cache
      if (cached?.tokens) {
        this.memoryCache.set(chainId, cached.tokens);
        return cached.tokens;
      }
      return [];
    }
  }

  /** Supported chain IDs that have a remote token list. */
  get supportedChains(): number[] {
    return Object.keys(CHAIN_SLUG).map(Number);
  }

  /**
   * Search tokens by partial symbol or name match.
   * Case-insensitive substring matching.
   */
  async search(chainId: number, query: string): Promise<TokenEntry[]> {
    const tokens = await this.getTokens(chainId);
    const needle = query.toLowerCase();
    return tokens.filter(
      (t) => t.symbol.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle),
    );
  }

  /**
   * Look up a single token by exact symbol (case-insensitive).
   */
  async findBySymbol(chainId: number, symbol: string): Promise<TokenEntry | undefined> {
    const tokens = await this.getTokens(chainId);
    const needle = symbol.toUpperCase();
    return tokens.find((t) => t.symbol.toUpperCase() === needle);
  }

  /**
   * Look up a single token by address (case-insensitive).
   */
  async findByAddress(chainId: number, address: string): Promise<TokenEntry | undefined> {
    const tokens = await this.getTokens(chainId);
    const needle = address.toLowerCase();
    return tokens.find((t) => t.address.toLowerCase() === needle);
  }

  // ─── Internal ────────────────────────────────────────────────────

  /**
   * Parse raw JSON entries, filter to matching chainId, and prepend native ETH.
   */
  private parseAndPrepend(raw: Array<Record<string, unknown>>, chainId: number): TokenEntry[] {
    const parsed: TokenEntry[] = raw
      .filter((t) => typeof t.address === 'string' && typeof t.symbol === 'string')
      .map((t) => ({
        address: t.address as string,
        chainId: (t.chainId as number) ?? chainId,
        name: (t.name as string) ?? '',
        symbol: (t.symbol as string) ?? '',
        decimals: (t.decimals as number) ?? 18,
      }));

    // Prepend native ETH as the first entry
    return [{ ...NATIVE_ETH, chainId }, ...parsed];
  }
}
