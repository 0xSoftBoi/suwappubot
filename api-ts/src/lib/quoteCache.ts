/**
 * Shared quote cache used by both agent and webapp swap routes.
 * Consolidates the separate in-memory caches that were in agent.ts and swap.ts.
 */

import { TTLCache } from './cache'

export interface CachedQuote {
	quote: any
	agentId?: number | undefined
	isSolana?: boolean | undefined
	// Decimals resolved at QUOTE time (when we still have the token registry in
	// scope). Execute-time code must never guess a decimals constant — see
	// agent.ts /swap/execute for the resolution precedence and the hard
	// rejection when these are unavailable and the raw quote carries none either.
	fromDecimals?: number | undefined
	toDecimals?: number | undefined
}

export interface CacheAgentQuoteOptions {
	fromDecimals?: number | undefined
	toDecimals?: number | undefined
}

const AGENT_QUOTE_TTL = 60_000 // 60 seconds
const WEBAPP_QUOTE_TTL = 30_000 // 30 seconds
const QUOTE_CACHE_MAX = 10_000

export const quoteCache = new TTLCache<CachedQuote>(AGENT_QUOTE_TTL, QUOTE_CACHE_MAX)

export function cacheAgentQuote(
	quoteId: string,
	quote: any,
	agentId: number,
	isSolana?: boolean,
	decimals?: CacheAgentQuoteOptions,
): void {
	quoteCache.set(
		quoteId,
		{
			quote,
			agentId,
			isSolana,
			fromDecimals: decimals?.fromDecimals,
			toDecimals: decimals?.toDecimals,
		},
		AGENT_QUOTE_TTL,
	)
}

export function cacheWebappQuote(quoteId: string, quote: any): void {
	quoteCache.set(quoteId, { quote }, WEBAPP_QUOTE_TTL)
}

export function getCachedQuote(quoteId: string): CachedQuote | null {
	return quoteCache.get(quoteId)
}

export function deleteCachedQuote(quoteId: string): void {
	quoteCache.delete(quoteId)
}
