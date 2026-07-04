import { and, eq, gt, gte, isNotNull, lt, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { http, createPublicClient, getAddress } from 'viem'
import { base } from 'viem/chains'
import { EnvService } from '../config/EnvService'
import { type DrizzleService, requireDb } from '../db'
import { feeTransactions } from '../db/schema/fees'
import { rewardEntries, rewardEpochs } from '../db/schema/onchainRewards'
import { DatabaseError } from '../errors'
import {
	CASHBACK_RATE,
	PAYOUT_CHAIN,
	PAYOUT_CHAIN_ID,
	PAYOUT_TOKEN,
	REWARDS_DISTRIBUTOR_ABI,
	currentEpochIndex,
	epochWindow,
} from '../lib/rewardsDistributor'

// Read API for on-chain fee-cashback rewards (Rewards v1). Python owns every
// write (accrual, finalize, publish, settle) — see bot/services/
// onchain_rewards_service.py. This service only reads the ledger and, when the
// distributor env vars are configured, the contract's isClaimed() state.

export interface RewardsEntryView {
	epochIndex: number
	amountUsd: number
	cashbackUsd: number
	carryoverUsd: number
	status: string
	claimDeadline: string | null
	claimedTxHash: string | null
	hasOnchainLeaf: boolean
}

export interface RewardsSummaryView {
	accruingUsd: number
	accruingEpochIndex: number
	accruingEndsAt: string
	claimableUsd: number
	onchainUsd: number
	lifetimeUsd: number
	carryoverUsd: number
	cashbackRate: number
	payoutToken: string
	payoutChain: string
	entries: RewardsEntryView[]
}

export interface ClaimPayload {
	epochId: number
	index: number
	account: string
	amount: string // uint256 base units, as string
	merkleProof: string[]
	distributor: string | null
	chainId: number
	claimDeadline: string | null
	alreadyClaimed: boolean | null // null = chain not configured/reachable
}

export interface RewardsServiceInterface {
	readonly getSummary: (
		userId: number,
	) => Effect.Effect<RewardsSummaryView, DatabaseError, DrizzleService>
	readonly getClaimPayload: (
		userId: number,
		epochIndex: number,
	) => Effect.Effect<ClaimPayload | null, DatabaseError, DrizzleService>
}

export class RewardsService extends Context.Tag('RewardsService')<
	RewardsService,
	RewardsServiceInterface
>() {}

export const RewardsServiceLive = Layer.effect(
	RewardsService,
	Effect.gen(function* () {
		const env = yield* EnvService

		const distributorAddress = env.REWARDS_DISTRIBUTOR_ADDRESS ?? null
		const publicClient =
			distributorAddress && env.REWARDS_RPC_URL
				? createPublicClient({ chain: base, transport: http(env.REWARDS_RPC_URL) })
				: null

		const isClaimedOnChain = async (
			epochIndex: number,
			leafIndex: number,
		): Promise<boolean | null> => {
			if (!publicClient || !distributorAddress) return null
			try {
				return await publicClient.readContract({
					address: getAddress(distributorAddress),
					abi: REWARDS_DISTRIBUTOR_ABI,
					functionName: 'isClaimed',
					args: [BigInt(epochIndex), BigInt(leafIndex)],
				})
			} catch {
				return null
			}
		}

		return {
			getSummary: (userId: number) =>
				Effect.gen(function* () {
					const db = yield* requireDb.pipe(
						Effect.mapError((e) => new DatabaseError({ message: e.message })),
					)

					const now = new Date()
					const accruingIndex = currentEpochIndex(now.getTime())
					const { startsAt, endsAt } = epochWindow(accruingIndex)

					const [liveBasis] = yield* Effect.tryPromise({
						try: () =>
							db
								.select({
									total: sql<number>`coalesce(sum(${feeTransactions.feeAmountUsd}), 0)`,
								})
								.from(feeTransactions)
								.where(
									and(
										eq(feeTransactions.userId, userId),
										gte(feeTransactions.createdAt, startsAt),
										lt(feeTransactions.createdAt, endsAt),
										isNotNull(feeTransactions.feeAmountUsd),
										gt(feeTransactions.feeAmountUsd, 0),
									),
								),
						catch: (e) =>
							new DatabaseError({ message: `Failed to read fee basis: ${e}`, cause: e }),
					})

					const rows = yield* Effect.tryPromise({
						try: () =>
							db
								.select({
									entry: rewardEntries,
									epoch: rewardEpochs,
								})
								.from(rewardEntries)
								.innerJoin(rewardEpochs, eq(rewardEntries.epochId, rewardEpochs.id))
								.where(eq(rewardEntries.userId, userId))
								.orderBy(sql`${rewardEpochs.epochIndex} desc`),
						catch: (e) =>
							new DatabaseError({ message: `Failed to read reward entries: ${e}`, cause: e }),
					})

					const summary: RewardsSummaryView = {
						accruingUsd: Math.round(Number(liveBasis?.total ?? 0) * CASHBACK_RATE * 1e6) / 1e6,
						accruingEpochIndex: accruingIndex,
						accruingEndsAt: endsAt.toISOString(),
						claimableUsd: 0,
						onchainUsd: 0,
						lifetimeUsd: 0,
						carryoverUsd: 0,
						cashbackRate: CASHBACK_RATE,
						payoutToken: PAYOUT_TOKEN,
						payoutChain: PAYOUT_CHAIN,
						entries: [],
					}

					for (const { entry, epoch } of rows) {
						const deadlinePassed =
							epoch.claimDeadline !== null && epoch.claimDeadline.getTime() < now.getTime()
						if (entry.status === 'claimable' || (entry.status === 'onchain' && deadlinePassed)) {
							summary.claimableUsd += entry.amountUsd
						} else if (entry.status === 'onchain') {
							summary.onchainUsd += entry.amountUsd
						} else if (entry.status === 'credited' || entry.status === 'claimed_onchain') {
							summary.lifetimeUsd += entry.amountUsd
						} else if (entry.status === 'carryover') {
							summary.carryoverUsd += entry.amountUsd
						}
						summary.entries.push({
							epochIndex: epoch.epochIndex,
							amountUsd: entry.amountUsd,
							cashbackUsd: entry.cashbackUsd,
							carryoverUsd: entry.carryoverUsd,
							status: entry.status,
							claimDeadline: epoch.claimDeadline?.toISOString() ?? null,
							claimedTxHash: entry.claimedTxHash,
							hasOnchainLeaf: entry.leafIndex !== null,
						})
					}
					summary.claimableUsd = Math.round(summary.claimableUsd * 1e6) / 1e6
					summary.onchainUsd = Math.round(summary.onchainUsd * 1e6) / 1e6
					summary.lifetimeUsd = Math.round(summary.lifetimeUsd * 1e6) / 1e6
					summary.carryoverUsd = Math.round(summary.carryoverUsd * 1e6) / 1e6

					return summary
				}),

			getClaimPayload: (userId: number, epochIndex: number) =>
				Effect.gen(function* () {
					const db = yield* requireDb.pipe(
						Effect.mapError((e) => new DatabaseError({ message: e.message })),
					)

					// SECURITY: the entry is looked up by the AUTHENTICATED user id —
					// a caller can never fetch another user's proof (proofs are not
					// secret on-chain, but leaking amounts per user would be).
					const rows = yield* Effect.tryPromise({
						try: () =>
							db
								.select({ entry: rewardEntries, epoch: rewardEpochs })
								.from(rewardEntries)
								.innerJoin(rewardEpochs, eq(rewardEntries.epochId, rewardEpochs.id))
								.where(
									and(
										eq(rewardEntries.userId, userId),
										eq(rewardEpochs.epochIndex, epochIndex),
									),
								),
						catch: (e) =>
							new DatabaseError({ message: `Failed to read claim payload: ${e}`, cause: e }),
					})

					const row = rows[0]
					if (
						!row ||
						row.entry.leafIndex === null ||
						!row.entry.claimAddress ||
						!row.entry.amountBaseUnits ||
						!row.entry.merkleProof ||
						row.entry.status !== 'onchain'
					) {
						return null
					}

					const alreadyClaimed = yield* Effect.tryPromise({
						try: () => isClaimedOnChain(epochIndex, row.entry.leafIndex as number),
						catch: () => new DatabaseError({ message: 'isClaimed read failed' }),
					}).pipe(Effect.orElseSucceed(() => null))

					return {
						epochId: epochIndex,
						index: row.entry.leafIndex,
						account: row.entry.claimAddress,
						amount: row.entry.amountBaseUnits,
						merkleProof: JSON.parse(row.entry.merkleProof) as string[],
						distributor: distributorAddress,
						chainId: PAYOUT_CHAIN_ID,
						claimDeadline: row.epoch.claimDeadline?.toISOString() ?? null,
						alreadyClaimed,
					} satisfies ClaimPayload
				}),
		}
	}),
)
