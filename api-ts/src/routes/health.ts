import { sql } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import { Hono } from 'hono'
import { logger } from '../lib/logger'
import packageJson from '../../package.json'
import developerContract from '../../developer-contract.json'
import { API_LIFECYCLE_REGISTRY } from '../lib/apiLifecycle'
import { DrizzleService } from '../db'
import { runEffectEither } from '../runtime'

import { sourceFingerprint } from '../lib/sourceFingerprint'
import { lifecycleFixtureRoutes } from './lifecycleFixture'
import { sandboxRoutes } from './sandbox'

const healthRoutes = new Hono()

// Public deterministic contract sandbox. This route is mounted through the root
// public route group so it can remain isolated from agent auth, billing, provider,
// wallet and internal-service middleware. The sandbox module itself has a tested
// no-production-dependencies boundary. See #874.
healthRoutes.route('/v1/sandbox', sandboxRoutes)
healthRoutes.route('/v1/sandbox', lifecycleFixtureRoutes)

// Public machine-readable developer contract. This is the same file CI validates;
// serving it directly avoids another hand-maintained API/SDK/sandbox metadata copy.
healthRoutes.get('/v1/developer-contract', (c) => {
	c.header('Cache-Control', 'public, max-age=300')
	return c.json(developerContract)
})

// Public machine-readable lifecycle registry. Deprecated/sunset resources are
// declared once here and consumed by both runtime header middleware and CI.
healthRoutes.get('/v1/api-lifecycle', (c) => {
	c.header('Cache-Control', 'public, max-age=300')
	return c.json(API_LIFECYCLE_REGISTRY)
})

let cachedDbStatus: { status: string; checkedAt: number } | null = null
const DB_HEALTH_TTL = 30_000

healthRoutes.get('/health', async (c) => {
	let dbStatus: { db: string }

	if (cachedDbStatus && Date.now() - cachedDbStatus.checkedAt < DB_HEALTH_TTL) {
		dbStatus = { db: cachedDbStatus.status }
	} else {
		const result = await runEffectEither(
			Effect.gen(function* () {
				const dbOption = yield* DrizzleService
				if (Option.isNone(dbOption)) {
					return { db: 'not_configured' as const }
				}
				const pingResult = yield* Effect.tryPromise({
					try: () => dbOption.value.execute(sql`SELECT 1`),
					catch: () => 'unreachable' as const,
				}).pipe(
					Effect.map(() => 'connected' as const),
					Effect.catchAll((err) => Effect.succeed(err)),
				)
				return { db: pingResult }
			}),
		)

		dbStatus = result._tag === 'Right' ? result.right : { db: 'error' as const }
		cachedDbStatus = { status: dbStatus.db, checkedAt: Date.now() }
	}

	const isHealthy = dbStatus.db !== 'unreachable' && dbStatus.db !== 'error'

	return c.json(
		{
			status: isHealthy ? 'ok' : 'degraded',
			service: 'suwappu-api-ts',
			version: packageJson.version,
			// Which build is answering. A green Railway deploy is NOT proof the
			// new code is live — verified painfully during the cookie-auth work,
			// where a 401 could equally mean "wrong code" or "not deployed".
			// Compare against scripts/verify_deploy.sh.
			source_fingerprint: sourceFingerprint(),
			timestamp: new Date().toISOString(),
			...dbStatus,
		},
		isHealthy ? 200 : 503,
	)
})

// Known good tokens (verified, no scams)
const VERIFIED_TOKENS: Record<string, string[]> = {
	'1': [
		'ETH',
		'USDC',
		'USDT',
		'WETH',
		'WBTC',
		'DAI',
		'LINK',
		'UNI',
		'AAVE',
		'MKR',
		'CRV',
		'LDO',
		'ARB',
		'OP',
		'MATIC',
		'PEPE',
		'SHIB',
	],
	'10': ['ETH', 'USDC', 'USDT', 'WETH', 'OP', 'DAI', 'LINK', 'WBTC'],
	'137': ['MATIC', 'USDC', 'USDT', 'WETH', 'WBTC', 'DAI', 'LINK', 'AAVE'],
	'42161': ['ETH', 'USDC', 'USDT', 'WETH', 'ARB', 'WBTC', 'DAI', 'LINK', 'GMX'],
	'8453': ['ETH', 'USDC', 'WETH', 'DAI', 'cbETH'],
	'56': ['BNB', 'USDC', 'USDT', 'WBNB', 'BUSD', 'ETH', 'BTCB'],
}

// PUBLIC endpoint - no auth required
const tokenListCache = new Map<string, { data: unknown; expiry: number }>()
const TOKEN_CACHE_TTL = 5 * 60 * 1000

healthRoutes.get('/tokens', async (c) => {
	const chainId = c.req.query('chainId') || '1'
	const verifiedSymbols = VERIFIED_TOKENS[chainId] || VERIFIED_TOKENS['1'] || []

	const cached = tokenListCache.get(chainId)
	if (cached && Date.now() < cached.expiry) {
		return c.json(cached.data)
	}

	try {
		const response = await fetch(`https://li.quest/v1/tokens?chains=${chainId}`, {
			headers: {
				Accept: 'application/json',
				...(process.env.LIFI_API_KEY && {
					'x-lifi-api-key': process.env.LIFI_API_KEY,
				}),
			},
		})

		if (!response.ok) {
			throw new Error(`Failed to fetch tokens: ${response.statusText}`)
		}

		const data = (await response.json()) as {
			tokens: Record<
				string,
				Array<{
					address: string
					symbol: string
					decimals: number
					name: string
					logoURI?: string
					priceUSD?: string
				}>
			>
		}
		const allTokens = data.tokens[chainId] || []

		// Filter to only verified tokens
		const tokens = allTokens.filter(
			(t) => verifiedSymbols.includes(t.symbol.toUpperCase()) || verifiedSymbols.includes(t.symbol),
		)

		const responseData = {
			chainId: parseInt(chainId, 10),
			tokens: tokens.map((t) => ({
				address: t.address,
				symbol: t.symbol,
				decimals: t.decimals,
				name: t.name,
				logoURI: t.logoURI,
				priceUSD: t.priceUSD,
			})),
		}

		tokenListCache.set(chainId, { data: responseData, expiry: Date.now() + TOKEN_CACHE_TTL })

		return c.json(responseData)
	} catch (error) {
		logger.error({ err: error }, '[Tokens] Failed to fetch')
		return c.json({ error: 'Failed to fetch tokens' }, 500)
	}
})

// PUBLIC endpoint - supported chains
healthRoutes.get('/chains', (c) => {
	const chains = [
		{
			id: 1,
			key: 'ethereum',
			name: 'Ethereum',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/ethereum.svg',
		},
		{
			id: 10,
			key: 'optimism',
			name: 'Optimism',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/optimism.svg',
		},
		{
			id: 56,
			key: 'bsc',
			name: 'BNB Chain',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/bsc.svg',
		},
		{
			id: 137,
			key: 'polygon',
			name: 'Polygon',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/polygon.svg',
		},
		{
			id: 42161,
			key: 'arbitrum',
			name: 'Arbitrum',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/arbitrum.svg',
		},
		{
			id: 43114,
			key: 'avalanche',
			name: 'Avalanche',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/avalanche.svg',
		},
		{
			id: 8453,
			key: 'base',
			name: 'Base',
			logoURI:
				'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/base.svg',
		},
	]
	return c.json({ chains })
})

export { healthRoutes }
