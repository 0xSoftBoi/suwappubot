import { and, desc, eq, sql } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import { distributionEpochs, epochRewards, requireDb, stakingPositions, tokenClaims, treasuryPositions } from '../db'
import { mapErrorToResponse } from '../errors'
import { telegramAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { UserService } from '../services'

// ─── Dependency-free on-chain reads (Superfluid GDA pool) ────────────────────
// Reads live USDCx stream state via raw JSON-RPC eth_call — no ethers/viem needed.
const SEL_CLAIMABLE = '0x21dd5777' // getClaimableNow(address) -> (int256, uint256)
const SEL_FLOWRATE = '0x539e8c1c' // getMemberFlowRate(address) -> int96

function pad32(addr: string): string {
	return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
	const res = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_call',
			params: [{ to, data }, 'latest'],
		}),
	})
	const json = (await res.json()) as { result?: string; error?: { message: string } }
	if (json.error) throw new Error(json.error.message)
	return json.result ?? '0x'
}

// Parse a hex two's-complement int from a 32-byte (64-hex) word
function parseSignedHex(word: string): bigint {
	let n = BigInt('0x' + word)
	const max = 1n << 256n
	if (n >= max >> 1n) n -= max
	return n
}

export const stakingRoutes = new Hono()

// GET /staking/overview — dashboard data for webapp
stakingRoutes.get('/overview', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser')
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const userService = yield* UserService

			// Resolve the internal DB user ID from the Telegram user
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			const dbUserId = Option.isSome(userOption) ? userOption.value.id : 0

			// Global stats
			const globalStats = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							totalStaked: sql<string>`coalesce(sum(suwp_staked), 0)`,
							stakerCount: sql<number>`count(*)`,
						})
						.from(stakingPositions)
						.where(and(eq(stakingPositions.isActive, 1), sql`suwp_staked > 0`)),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			// User's position
			const userPosRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(stakingPositions)
						.where(eq(stakingPositions.userId, dbUserId))
						.limit(1),
				catch: (e) => new Error(`Database error: ${e}`),
			})
			const userPos = userPosRows[0]

			// User's pending rewards
			const pendingRewards = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(epochRewards)
						.where(
							and(
								eq(epochRewards.userId, dbUserId),
								eq(epochRewards.status, 'pending'),
							),
						),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			// User's pending/recent claims
			const claims = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(tokenClaims)
						.where(eq(tokenClaims.userId, dbUserId))
						.orderBy(desc(tokenClaims.createdAt))
						.limit(10),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			// Recent epochs
			const epochs = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(distributionEpochs)
						.orderBy(desc(distributionEpochs.epochNumber))
						.limit(4),
				catch: (e) => new Error(`Database error: ${e}`),
			})

			const globalRow = globalStats[0]
			const totalStaked = parseFloat(globalRow?.totalStaked ?? '0')
			const userStaked = parseFloat(userPos?.suwpStaked ?? '0')
			const poolSharePct = totalStaked > 0 ? (userStaked / totalStaked) * 100 : 0

			const pendingUsdc = pendingRewards.reduce((s, r) => s + parseFloat(r.usdcReward), 0)
			const pendingSuwp = pendingRewards.reduce((s, r) => s + parseFloat(r.suwpBonus), 0)

			return {
				global: {
					total_suwp_staked: totalStaked,
					staker_count: globalRow?.stakerCount ?? 0,
				},
				position: userPos
					? {
						suwp_staked: userStaked,
						pool_share_pct: poolSharePct,
						wallet_address: userPos.walletAddress,
						staked_since: userPos.stakedSince,
					}
					: null,
				pending_rewards: {
					usdc: pendingUsdc,          // keep for backward compat (now always 0 from DB)
					suwp_bonus: pendingSuwp,    // from EpochReward records (still batch)
					streaming_note: 'USDC streams continuously via Superfluid. Check your wallet for USDCx balance.',
				},
				streaming: {
					pool_address: process.env.STAKING_POOL_ADDRESS ?? null,
					balance_endpoint: '/staking/streaming-balance?address=<wallet>',
					note: 'USDC rewards stream per-second via Superfluid GDA pool. Use Superfluid dashboard or claim USDCx directly.',
				},
				recent_claims: claims,
				recent_epochs: epochs,
			}
		}),
	)
	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	return c.json(result.right)
})

// GET /staking/epochs — distribution history
stakingRoutes.get('/epochs', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(distributionEpochs)
						.orderBy(desc(distributionEpochs.epochNumber))
						.limit(12),
				catch: (e) => new Error(`Database error: ${e}`),
			})
		}),
	)
	if (Either.isLeft(result)) return c.json([], 200)
	return c.json(result.right)
})

// GET /staking/vault — Treasury vault stats
stakingRoutes.get('/vault', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const positions = yield* Effect.tryPromise({
				try: () => db.select().from(treasuryPositions).limit(1),
				catch: (e) => new Error(`DB error: ${e}`),
			})
			const pos = positions[0]

			const recentEpochs = yield* Effect.tryPromise({
				try: () =>
					db
						.select({
							epochNumber: distributionEpochs.epochNumber,
							directFeesUsdc: distributionEpochs.directFeesUsdc,
							treasuryYieldUsdc: distributionEpochs.treasuryYieldUsdc,
							totalStakerUsdc: distributionEpochs.totalStakerUsdc,
							treasuryAumUsdc: distributionEpochs.treasuryAumUsdc,
							periodEnd: distributionEpochs.periodEnd,
						})
						.from(distributionEpochs)
						.where(eq(distributionEpochs.status, 'completed'))
						.orderBy(desc(distributionEpochs.epochNumber))
						.limit(4),
				catch: (e) => new Error(`DB error: ${e}`),
			})

			const principal = parseFloat(pos?.principalUsdc ?? '0')
			const balance = parseFloat(pos?.currentATokenBalance ?? '0')

			return {
				vault_name: pos?.vaultName ?? 'aave_v3_base_usdc',
				chain: pos?.chain ?? 'base',
				principal_usdc: principal,
				current_balance_usdc: balance,
				yield_earned_usdc: Math.max(balance - principal, 0),
				total_yield_harvested_usdc: parseFloat(pos?.totalYieldHarvestedUsdc ?? '0'),
				last_deposit_at: pos?.lastDepositAt ?? null,
				last_harvest_at: pos?.lastHarvestAt ?? null,
				recent_epoch_yields: recentEpochs.map((e) => ({
					epoch: e.epochNumber,
					direct_fees_usdc: parseFloat(e.directFeesUsdc ?? '0'),
					vault_yield_usdc: parseFloat(e.treasuryYieldUsdc ?? '0'),
					total_staker_usdc: parseFloat(e.totalStakerUsdc ?? '0'),
					treasury_aum_usdc: parseFloat(e.treasuryAumUsdc ?? '0'),
					period_end: e.periodEnd,
				})),
			}
		}),
	)
	if (Either.isLeft(result)) {
		return c.json({ vault_name: 'aave_v3_base_usdc', chain: 'base', error: 'unavailable' })
	}
	return c.json(result.right)
})

// GET /staking/bonds — treasury LP holdings summary (public)
stakingRoutes.get('/bonds', async (c) => {
	// Placeholder: once SuwppuBonds contract is deployed and indexed,
	// this will query on-chain bond data or a bonds DB table.
	// For now, return treasury stats and contract address.
	return c.json({
		bonds_contract: process.env.BONDS_CONTRACT_ADDRESS ?? null,
		total_lp_bonded: 0,
		total_suwp_issued: 0,
		discount_bps: 500,
		vesting_days: 7,
		note: 'Bond your SUWP/USDC Uniswap v3 LP NFT for discounted SUWP. Contract pending deployment.',
		uniswap_pool: process.env.SUWP_USDC_POOL_ADDRESS ?? null,
	})
})

// GET /staking/apy — estimated APY based on recent epoch
stakingRoutes.get('/apy', async (c) => {
	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const rows = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(distributionEpochs)
						.where(eq(distributionEpochs.status, 'completed'))
						.orderBy(desc(distributionEpochs.epochNumber))
						.limit(1),
				catch: (e) => new Error(`Database error: ${e}`),
			})
			const latestEpoch = rows[0]

			if (!latestEpoch) return { apy_estimate_pct: null, note: 'No completed epochs yet' }

			const totalStaked = parseFloat(latestEpoch.totalSuwpStaked)
			const weeklyUsdc = parseFloat(latestEpoch.stakingPoolUsdc)
			// Annualise: 52 weeks, expressed as % of staked value (assuming $1/SUWP for now)
			const apyPct = totalStaked > 0 ? ((weeklyUsdc * 52) / totalStaked) * 100 : null

			// Compute breakdown from new epoch columns
			const weeklyFees = parseFloat(latestEpoch.directFeesUsdc ?? latestEpoch.stakingPoolUsdc ?? '0')
			const weeklyVault = parseFloat(latestEpoch.treasuryYieldUsdc ?? '0')
			const feeApyPct = totalStaked > 0 ? ((weeklyFees * 52) / totalStaked) * 100 : null
			const vaultApyPct = totalStaked > 0 ? ((weeklyVault * 52) / totalStaked) * 100 : null

			return {
				apy_estimate_pct: apyPct,
				fee_apy_pct: feeApyPct,
				vault_apy_pct: vaultApyPct,
				weekly_usdc_pool: weeklyUsdc,
				total_staked: totalStaked,
				streaming_model: true,   // tells frontend USDC streams continuously via Superfluid GDA
			}
		}),
	)
	if (Either.isLeft(result)) return c.json({ apy_estimate_pct: null })
	return c.json(result.right)
})

// GET /staking/streaming-balance?address=0x... — live USDCx stream from the GDA pool
stakingRoutes.get('/streaming-balance', async (c) => {
	const address = c.req.query('address')
	if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
		return c.json({ error: 'valid ?address=0x... required' }, 400)
	}
	const rpcUrl = process.env.BASE_RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL
	const pool = process.env.STAKING_POOL_ADDRESS
	if (!rpcUrl || !pool) {
		return c.json({ streaming: false, note: 'STAKING_POOL_ADDRESS / BASE_RPC_URL not configured' })
	}

	try {
		const [claimableHex, flowHex] = await Promise.all([
			ethCall(rpcUrl, pool, SEL_CLAIMABLE + pad32(address)),
			ethCall(rpcUrl, pool, SEL_FLOWRATE + pad32(address)),
		])
		// getClaimableNow returns (int256 claimable, uint256 timestamp) — first word is claimable
		const claimableWei = parseSignedHex(claimableHex.replace(/^0x/, '').slice(0, 64) || '0')
		const flowWei = parseSignedHex(flowHex.replace(/^0x/, '').padStart(64, '0'))
		const toUsdc = (w: bigint) => Number(w) / 1e18

		return c.json({
			streaming: flowWei > 0n,
			address,
			claimable_usdcx: toUsdc(claimableWei),
			flow_rate_per_sec: toUsdc(flowWei),
			flow_rate_per_day: toUsdc(flowWei) * 86400,
			pool,
			note: 'USDCx accrues per second; claim via Superfluid pool.claimAll() or it auto-settles.',
		})
	} catch (e) {
		return c.json({ streaming: false, error: String(e) }, 200)
	}
})
