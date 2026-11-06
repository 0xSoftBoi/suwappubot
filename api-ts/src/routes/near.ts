/**
 * First-class NEAR surface — /v1/near/*
 *
 * Public, read-only. Wraps the OutLayer agent-custody wallet
 * (https://skills.outlayer.ai/agent-custody/SKILL.md) and NEAR Intents.
 *
 *  GET  /status          — networks, hosts, what this surface does and does NOT do
 *  GET  /assets          — curated asset registry (chain-disambiguated defuse ids)
 *  GET  /assets/resolve  — symbol|id (+chain) -> exactly one asset, or `ambiguous`
 *  GET  /amount          — decimal <-> atomic conversion for an asset
 *  GET  /tokens          — LIVE OutLayer catalog   (Authorization: Bearer wk_…)
 *  GET  /address         — wallet address          (Bearer wk_…)
 *  GET  /balance         — wallet or intents bal.  (Bearer wk_…)
 *  POST /swap/quote      — NEAR Intents quote      (Bearer wk_…, mainnet only)
 *
 * NOT here, on purpose: register, swap/transfer/withdraw execution. Those move
 * value or create custody; the agent calls OutLayer directly with its own key so
 * Suwappu is never in the signing path. The caller's wk_ is passed through for a
 * single request and never stored or logged.
 */
import { Hono } from 'hono'
import {
	fromAtomic,
	NEAR_ASSETS,
	normalizeNearChain,
	resolveNearAsset,
	toAtomic,
} from '../services/near/assets'
import {
	extractWalletKey,
	getAddress,
	getBalance,
	getTokens,
	OUTLAYER_HOSTS,
	OUTLAYER_SKILL_URL,
	OutLayerError,
	swapQuote,
	type NearNetwork,
} from '../services/near/outlayer'

export const nearRoutes = new Hono()

const networkOf = (raw: string | undefined): NearNetwork | null =>
	raw === undefined || raw === 'mainnet' ? 'mainnet' : raw === 'testnet' ? 'testnet' : null

nearRoutes.get('/status', (c) =>
	c.json({
		surface: 'suwappu.near/v1',
		networks: { mainnet: OUTLAYER_HOSTS.mainnet, testnet: OUTLAYER_HOSTS.testnet },
		custody: { provider: 'OutLayer', skill: OUTLAYER_SKILL_URL, keysHeldBy: 'TEE (OutLayer); never Suwappu' },
		capabilities: {
			assetRegistry: true,
			assetResolve: true,
			amountConversion: true,
			walletReads: true,
			swapQuote: 'mainnet-only (NEAR Intents has no solvers on testnet)',
			execution: 'not proxied — call OutLayer directly with your own wk_ key',
		},
		arbiter: '/hackathon/arbiter (flag-gated NEAR testnet escrow demo)',
		assetCount: NEAR_ASSETS.length,
	}),
)

nearRoutes.get('/assets', (c) => {
	const chain = c.req.query('chain')
	const want = chain ? normalizeNearChain(chain) : null
	const assets = want ? NEAR_ASSETS.filter((a) => a.chain === want) : NEAR_ASSETS
	return c.json({
		assets,
		note: 'Curated subset. Symbols are not unique across chains — select by defuseAssetId.',
	})
})

nearRoutes.get('/assets/resolve', (c) => {
	const token = c.req.query('token')
	if (!token) return c.json({ error: 'token query param required' }, 400)
	const r = resolveNearAsset(token, c.req.query('chain'))
	return c.json(r, r.status === 'ok' ? 200 : r.status === 'ambiguous' ? 409 : 404)
})

nearRoutes.get('/amount', (c) => {
	const token = c.req.query('token')
	if (!token) return c.json({ error: 'token query param required' }, 400)
	const r = resolveNearAsset(token, c.req.query('chain'))
	if (r.status !== 'ok') return c.json(r, r.status === 'ambiguous' ? 409 : 404)
	const human = c.req.query('human')
	const atomic = c.req.query('atomic')
	try {
		if (human !== undefined) {
			return c.json({ asset: r.asset, human, atomic: toAtomic(human, r.asset.decimals) })
		}
		if (atomic !== undefined) {
			return c.json({ asset: r.asset, atomic, human: fromAtomic(atomic, r.asset.decimals) })
		}
	} catch (e) {
		return c.json({ error: e instanceof Error ? e.message : 'bad amount' }, 400)
	}
	return c.json({ error: 'provide human= or atomic=' }, 400)
})

// ---- key-passthrough reads -------------------------------------------------

type KeyedHandler = (
	c: import('hono').Context,
	key: string,
	network: NearNetwork,
) => Promise<Response>

const withKey =
	(fn: KeyedHandler) =>
	async (c: import('hono').Context): Promise<Response> => {
		const key = extractWalletKey(c.req.header('authorization'))
		if (!key) {
			return c.json({ error: 'Authorization: Bearer wk_<64 hex> required (your OutLayer wallet key)' }, 401)
		}
		const network = networkOf(c.req.query('network'))
		if (!network) return c.json({ error: 'network must be mainnet or testnet' }, 400)
		try {
			return await fn(c, key, network)
		} catch (e) {
			if (e instanceof OutLayerError) {
				const status = e.status >= 400 && e.status < 600 ? e.status : 502
				return c.json({ error: e.message, upstream: e.body ?? null }, status as 400)
			}
			throw e
		}
	}

nearRoutes.get('/tokens', withKey(async (c, key, network) => c.json(await getTokens(network, key))))

nearRoutes.get(
	'/address',
	withKey(async (c, key, network) => c.json(await getAddress(network, key, c.req.query('chain') ?? 'near'))),
)

nearRoutes.get(
	'/balance',
	withKey(async (c, key, network) => {
		const source = c.req.query('source')
		if (source !== undefined && source !== 'intents') return c.json({ error: 'source must be "intents" if set' }, 400)
		const token = c.req.query('token')
		return c.json(
			await getBalance(network, key, {
				chain: source ? undefined : (c.req.query('chain') ?? 'near'),
				token: token || undefined,
				source: source as 'intents' | undefined,
			}),
		)
	}),
)

nearRoutes.post(
	'/swap/quote',
	withKey(async (c, key, network) => {
		let b: { token_in?: string; token_out?: string; amount_in?: string; chain_in?: string; chain_out?: string }
		try {
			b = await c.req.json()
		} catch {
			return c.json({ error: 'bad_json' }, 400)
		}
		if (!b.token_in || !b.token_out || !b.amount_in) {
			return c.json({ error: 'token_in, token_out, amount_in required' }, 400)
		}
		if (!/^\d+$/.test(b.amount_in)) {
			return c.json({ error: 'amount_in must be an atomic integer string (use GET /v1/near/amount)' }, 400)
		}
		// Refuse symbol guessing: each side must resolve to exactly one asset (or be a raw
		// nep141:/nep245:/1cs_v1: id from the live catalog).
		const sides: Array<[string, string, string | undefined]> = [
			['token_in', b.token_in, b.chain_in],
			['token_out', b.token_out, b.chain_out],
		]
		const ids: Record<string, string> = {}
		for (const [field, ref, chain] of sides) {
			if (/^(nep141|nep245|1cs_v1):/.test(ref)) {
				ids[field] = ref
				continue
			}
			const r = resolveNearAsset(ref, chain)
			if (r.status !== 'ok') return c.json({ field, ...r }, r.status === 'ambiguous' ? 409 : 404)
			ids[field] = r.asset.defuseAssetId
		}
		const quote = await swapQuote(network, key, {
			token_in: ids.token_in as string,
			token_out: ids.token_out as string,
			amount_in: b.amount_in,
		})
		return c.json({
			quote,
			resolved: ids,
			warning:
				'amount_out here is an ESTIMATE. The realized fill is result.amount_out at status=="success" from OutLayer /intents/swap — never record qty/PnL from a quote.',
		})
	}),
)
