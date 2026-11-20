/**
 * NEAR Intents asset registry + amount helpers.
 *
 * Source: OutLayer agent-custody skill, references/token-reference.md
 * (https://skills.outlayer.ai/agent-custody/references/token-reference.md).
 * This is a CURATED subset for resolution/validation; the authoritative live
 * list is OutLayer `GET /wallet/v1/tokens` (see outlayer.ts).
 *
 * The one rule this module exists to enforce: a display symbol is NOT an
 * identity. "USDC" is ~17 different assets across chains. `resolveNearAsset`
 * therefore returns `ambiguous` (with every candidate) instead of guessing —
 * picking the wrong chain's variant on a deposit/withdraw strands funds.
 */

export interface NearAsset {
	symbol: string
	/** Id on intents.near, with nep141:/nep245: prefix. Use for swap token_in/out. */
	defuseAssetId: string
	/** Plain NEAR contract id, only for assets that live natively on NEAR. */
	contractId?: string
	decimals: number
	/** Chain the asset natively settles on (lowercase). */
	chain: string
}

const omft = (addr: string) => `nep141:${addr}.omft.near`

export const NEAR_ASSETS: readonly NearAsset[] = [
	// NEAR-native
	{ symbol: 'wNEAR', defuseAssetId: 'nep141:wrap.near', contractId: 'wrap.near', decimals: 24, chain: 'near' },
	{ symbol: 'USDT', defuseAssetId: 'nep141:usdt.tether-token.near', contractId: 'usdt.tether-token.near', decimals: 6, chain: 'near' },
	{
		symbol: 'USDC',
		defuseAssetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
		contractId: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
		decimals: 6,
		chain: 'near',
	},
	{ symbol: 'stNEAR', defuseAssetId: 'nep141:meta-pool.near', contractId: 'meta-pool.near', decimals: 24, chain: 'near' },
	{ symbol: 'SWEAT', defuseAssetId: 'nep141:token.sweat', contractId: 'token.sweat', decimals: 18, chain: 'near' },
	{ symbol: 'mpDAO', defuseAssetId: 'nep141:mpdao-token.near', contractId: 'mpdao-token.near', decimals: 6, chain: 'near' },
	// Majors (omft bridge)
	{ symbol: 'ETH', defuseAssetId: 'nep141:eth.omft.near', decimals: 18, chain: 'ethereum' },
	{ symbol: 'ETH', defuseAssetId: 'nep141:arb.omft.near', decimals: 18, chain: 'arbitrum' },
	{ symbol: 'ETH', defuseAssetId: 'nep141:base.omft.near', decimals: 18, chain: 'base' },
	{ symbol: 'BTC', defuseAssetId: 'nep141:btc.omft.near', decimals: 8, chain: 'bitcoin' },
	{ symbol: 'SOL', defuseAssetId: 'nep141:sol.omft.near', decimals: 9, chain: 'solana' },
	{ symbol: 'DOGE', defuseAssetId: 'nep141:doge.omft.near', decimals: 8, chain: 'dogecoin' },
	{ symbol: 'XRP', defuseAssetId: 'nep141:xrp.omft.near', decimals: 6, chain: 'xrp' },
	{ symbol: 'ZEC', defuseAssetId: 'nep141:zec.omft.near', decimals: 8, chain: 'zcash' },
	{ symbol: 'SUI', defuseAssetId: 'nep141:sui.omft.near', decimals: 9, chain: 'sui' },
	{ symbol: 'APT', defuseAssetId: 'nep141:aptos.omft.near', decimals: 8, chain: 'aptos' },
	{ symbol: 'BERA', defuseAssetId: 'nep141:bera.omft.near', decimals: 18, chain: 'berachain' },
	// Stablecoins on other chains
	{ symbol: 'USDT', defuseAssetId: omft('eth-0xdac17f958d2ee523a2206206994597c13d831ec7'), decimals: 6, chain: 'ethereum' },
	{ symbol: 'USDC', defuseAssetId: omft('eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'), decimals: 6, chain: 'ethereum' },
	{ symbol: 'USDC', defuseAssetId: omft('base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'), decimals: 6, chain: 'base' },
	{ symbol: 'USDC', defuseAssetId: omft('arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831'), decimals: 6, chain: 'arbitrum' },
	{ symbol: 'USDC', defuseAssetId: omft('sol-5ce3bf3a31af18be40ba30f721101b4341690186'), decimals: 6, chain: 'solana' },
	{ symbol: 'DAI', defuseAssetId: omft('eth-0x6b175474e89094c44da98b954eedeac495271d0f'), decimals: 18, chain: 'ethereum' },
	{ symbol: 'WBTC', defuseAssetId: omft('eth-0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'), decimals: 8, chain: 'ethereum' },
	{ symbol: 'cbBTC', defuseAssetId: omft('base-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'), decimals: 8, chain: 'base' },
	{ symbol: 'LINK', defuseAssetId: omft('eth-0x514910771af9ca656af840dff83e8264ecf986ca'), decimals: 18, chain: 'ethereum' },
	{ symbol: 'UNI', defuseAssetId: omft('eth-0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'), decimals: 18, chain: 'ethereum' },
	{ symbol: 'AAVE', defuseAssetId: omft('eth-0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'), decimals: 18, chain: 'ethereum' },
	{ symbol: 'ARB', defuseAssetId: omft('arb-0x912ce59144191c1204e64559fe8253a0e49e6548'), decimals: 18, chain: 'arbitrum' },
	// HOT bridge (nep245)
	{ symbol: 'BNB', defuseAssetId: 'nep245:v2_1.omni.hot.tg:56_11111111111111111111', decimals: 18, chain: 'bsc' },
	{ symbol: 'POL', defuseAssetId: 'nep245:v2_1.omni.hot.tg:137_11111111111111111111', decimals: 18, chain: 'polygon' },
	{ symbol: 'TON', defuseAssetId: 'nep245:v2_1.omni.hot.tg:1117_', decimals: 9, chain: 'ton' },
	{ symbol: 'OP', defuseAssetId: 'nep245:v2_1.omni.hot.tg:10_vLAiSt9KfUGKpw5cD3vsSyNYBo7', decimals: 18, chain: 'optimism' },
	{ symbol: 'AVAX', defuseAssetId: 'nep245:v2_1.omni.hot.tg:43114_11111111111111111111', decimals: 18, chain: 'avalanche' },
]

/** Chain-name aliases agents commonly use. */
const CHAIN_ALIASES: Record<string, string> = {
	eth: 'ethereum',
	mainnet: 'ethereum',
	arb: 'arbitrum',
	op: 'optimism',
	pol: 'polygon',
	matic: 'polygon',
	avax: 'avalanche',
	sol: 'solana',
	btc: 'bitcoin',
	bnb: 'bsc',
}

export const normalizeNearChain = (chain: string): string => {
	const c = chain.trim().toLowerCase()
	return CHAIN_ALIASES[c] ?? c
}

export type ResolveResult =
	| { status: 'ok'; asset: NearAsset }
	| { status: 'ambiguous'; candidates: NearAsset[]; hint: string }
	| { status: 'not_found'; hint: string }

/**
 * Resolve a token reference to exactly one asset, or refuse.
 *
 * Accepts a defuse asset id (`nep141:…`/`nep245:…`), a bare NEAR contract id,
 * or a symbol (+ optional chain). A symbol with several chain variants and no
 * `chain` is `ambiguous` — never defaulted.
 */
export function resolveNearAsset(ref: string, chain?: string): ResolveResult {
	const q = ref.trim()
	if (!q) return { status: 'not_found', hint: 'Empty token reference.' }

	const byId = NEAR_ASSETS.find(
		(a) => a.defuseAssetId.toLowerCase() === q.toLowerCase() || a.contractId?.toLowerCase() === q.toLowerCase(),
	)
	if (byId) return { status: 'ok', asset: byId }

	const sym = q.toLowerCase()
	let matches = NEAR_ASSETS.filter((a) => a.symbol.toLowerCase() === sym)
	if (matches.length === 0) {
		return {
			status: 'not_found',
			hint: 'Not in the curated registry. Look it up via GET /v1/near/tokens (live OutLayer catalog) and select by exact defuse_asset_id.',
		}
	}
	if (chain) {
		const want = normalizeNearChain(chain)
		matches = matches.filter((a) => a.chain === want)
		if (matches.length === 0) {
			return { status: 'not_found', hint: `No ${ref} variant on ${want} in the curated registry.` }
		}
	}
	if (matches.length === 1) return { status: 'ok', asset: matches[0] as NearAsset }
	return {
		status: 'ambiguous',
		candidates: matches,
		hint: `"${ref}" exists on ${matches.length} chains. Pass chain=<one of ${matches.map((m) => m.chain).join(', ')}> or use the exact defuseAssetId. Symbols are not identities.`,
	}
}

/** Decimal string ("1.5") -> atomic integer string (decimals-scaled). Throws on bad input. */
export function toAtomic(amount: string, decimals: number): string {
	const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim())
	if (!m) throw new Error(`invalid amount "${amount}"`)
	const whole = m[1] as string
	const frac = m[2] ?? ''
	if (frac.length > decimals) throw new Error(`amount has more than ${decimals} decimal places`)
	const atomic = (whole + frac.padEnd(decimals, '0')).replace(/^0+(?=\d)/, '')
	return atomic === '' ? '0' : atomic
}

/** Atomic integer string -> decimal string, trailing zeros trimmed. */
export function fromAtomic(atomic: string, decimals: number): string {
	if (!/^\d+$/.test(atomic)) throw new Error(`invalid atomic amount "${atomic}"`)
	const padded = atomic.padStart(decimals + 1, '0')
	const whole = padded.slice(0, padded.length - decimals)
	const frac = padded.slice(padded.length - decimals).replace(/0+$/, '')
	return frac ? `${whole}.${frac}` : whole
}
