import { sql } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import { Hono } from 'hono'
import { logger } from '../lib/logger'
import packageJson from '../../package.json'
import { DrizzleService } from '../db'
import { runEffectEither } from '../runtime'

const healthRoutes = new Hono()

healthRoutes.get('/health', async (c) => {
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

	const dbStatus = result._tag === 'Right' ? result.right : { db: 'error' as const }
	const isHealthy = dbStatus.db !== 'unreachable' && dbStatus.db !== 'error'

	return c.json(
		{
			status: isHealthy ? 'ok' : 'degraded',
			service: 'suwappu-api-ts',
			version: packageJson.version,
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
healthRoutes.get('/tokens', async (c) => {
	const chainId = c.req.query('chainId') || '1'
	const verifiedSymbols = VERIFIED_TOKENS[chainId] || VERIFIED_TOKENS['1']

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

		return c.json({
			chainId: parseInt(chainId, 10),
			tokens: tokens.map((t) => ({
				address: t.address,
				symbol: t.symbol,
				decimals: t.decimals,
				name: t.name,
				logoURI: t.logoURI,
				priceUSD: t.priceUSD,
			})),
		})
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
