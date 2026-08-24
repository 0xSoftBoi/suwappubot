/**
 * Discovery — which list we ask for, and in what order we trust the answers.
 *
 * This is the file that decides what kind of agent this is. Pointed at a
 * chain's largest pools it is a slow blue-chip agent no matter what the rest
 * of the system does.
 */
import { describe, expect, it } from 'bun:test'
import {
	dedupeByToken,
	discoveryOrder,
	geckoPoolToCandidate,
	isQuoteAsset,
} from '../services/autopilot/market'
import type { Candidate } from '../services/autopilot/types'

const cand = (over: Partial<Candidate> = {}): Candidate => ({
	chain: 'solana',
	tokenAddress: 'Tok1',
	symbol: 'MEME',
	priceUsd: 1,
	liquidityUsd: 50_000,
	volume24hUsd: 1_000_000,
	...over,
})

describe('discoveryOrder', () => {
	it('puts trending ahead of new, and both ahead of paid boosts', () => {
		// Someone paying for a listing is the weakest reason to look at a token.
		const trending = cand({ source: 'trending', sourceRank: 19 })
		const fresh = cand({ source: 'new', sourceRank: 0 })
		const boosted = cand({ source: undefined, sourceRank: undefined })
		expect(discoveryOrder(trending)).toBeLessThan(discoveryOrder(fresh))
		expect(discoveryOrder(fresh)).toBeLessThan(discoveryOrder(boosted))
	})

	it('preserves each source list its own ranking', () => {
		expect(discoveryOrder(cand({ source: 'trending', sourceRank: 0 }))).toBeLessThan(
			discoveryOrder(cand({ source: 'trending', sourceRank: 5 })),
		)
	})

	it('does not let a deep pool outrank a better-placed shallow one', () => {
		// The bug this pins: ranking by absolute 24h volume re-sorts every source
		// into a list of the chain's biggest pools, which is what asking for
		// trending pools was supposed to stop. A $35k memecoin at trending rank 3
		// must beat a $24m blue chip at rank 5.
		const memecoin = cand({ source: 'trending', sourceRank: 3, liquidityUsd: 34_685 })
		const bluechip = cand({
			source: 'trending',
			sourceRank: 5,
			liquidityUsd: 24_459_427,
			volume24hUsd: 15_466_098,
		})
		const sorted = [bluechip, memecoin].sort((a, b) => discoveryOrder(a) - discoveryOrder(b))
		expect(sorted[0]!.liquidityUsd).toBe(34_685)
	})
})

describe('geckoPoolToCandidate', () => {
	const pool = {
		attributes: {
			name: 'CYBERLEEK / SOL',
			base_token_price_usd: '0.0042',
			reserve_in_usd: '1864098.1',
			volume_usd: { h24: '37672573.4' },
			price_change_percentage: { h1: '12.5' },
			pool_created_at: new Date(Date.now() - 120 * 60_000).toISOString(),
		},
		relationships: { base_token: { data: { id: 'solana_Tok1' } } },
	}

	it('reads the base token out of the pool name and strips the network prefix', () => {
		const c = geckoPoolToCandidate(pool, 'solana')!
		expect(c.symbol).toBe('CYBERLEEK')
		expect(c.tokenAddress).toBe('Tok1')
		expect(c.liquidityUsd).toBeCloseTo(1_864_098.1, 1)
		expect(c.ageMinutes).toBeGreaterThanOrEqual(119)
	})

	it('refuses a pool it cannot price or identify', () => {
		expect(geckoPoolToCandidate({ attributes: { name: 'X / SOL' } }, 'solana')).toBeNull()
		expect(
			geckoPoolToCandidate(
				{ ...pool, attributes: { ...pool.attributes, base_token_price_usd: '0' } },
				'solana',
			),
		).toBeNull()
	})
})

describe('the screener never offers the asset it quotes against', () => {
	it('knows the quote assets on every supported chain', () => {
		for (const s of ['SOL', 'wsol', 'WETH', 'usdc', 'USDT']) expect(isQuoteAsset(s)).toBe(true)
		for (const s of ['CYBERLEEK', 'MIGGLES', 'Basecat']) expect(isQuoteAsset(s)).toBe(false)
	})
})

describe('dedupeByToken', () => {
	it('keeps the deepest pool when the same token appears in two lists', () => {
		// A token can be both trending and newly pooled. We trade the deeper pool.
		const out = dedupeByToken([
			cand({ source: 'new', liquidityUsd: 5_000 }),
			cand({ source: 'trending', liquidityUsd: 80_000 }),
		])
		expect(out).toHaveLength(1)
		expect(out[0]!.liquidityUsd).toBe(80_000)
	})
})

describe('multi-chain discovery', () => {
	it('interleaves chains rather than letting the first one monopolise the list', () => {
		// Non-obvious and load-bearing. Every chain's trending rank 0 shares the
		// same sort key, so the interleave depends entirely on the sort being
		// stable and the fetch order being chain-major. If that ever changes,
		// `base` silently eats the whole candidate budget and the other four
		// chains stop being traded without anything failing.
		const chains = ['base', 'solana', 'bsc', 'hyperevm', 'robinhood']
		const all = chains.flatMap((chain) =>
			Array.from({ length: 20 }, (_, rank) =>
				cand({ chain, tokenAddress: `${chain}-${rank}`, source: 'trending', sourceRank: rank }),
			),
		)
		const top = all
			.sort((a, b) => discoveryOrder(a) - discoveryOrder(b))
			.slice(0, 10)
			.map((c) => c.chain)
		// Ranks 0 and 1 from each of the five chains, in chain order.
		expect(top).toEqual([...chains, ...chains])
	})

	it('ranks every chain trending ahead of any chain new pools', () => {
		const trendingLast = cand({ chain: 'robinhood', source: 'trending', sourceRank: 19 })
		const newFirst = cand({ chain: 'base', source: 'new', sourceRank: 0 })
		expect(discoveryOrder(trendingLast)).toBeLessThan(discoveryOrder(newFirst))
	})
})
