/**
 * Cross-line VIP status (api-ts mirror of bot/services/vip_service.py).
 *
 * A user's EFFECTIVE tier is the better of their paid subscription and an activity
 * band earned from cross-product trading volume THIS SEASON (the single
 * `season_points.swap_volume_usd` column, fed by swaps + perps + predict + P2P).
 *
 * Used in api-ts for: fee-denominating season accrual on api-ts swaps (feeUsd in
 * internal swap completion), the VIP-aware loyalty multiplier, and surfacing the
 * status on /webapp/me. The AUTHORITATIVE on-chain fee discount lives in the Python
 * fee_service; these helpers are read-only and defensive (fall back to 'free').
 *
 * Keep ACTIVITY_BANDS / TIER_FEE_FRACTION in sync with bot/services/vip_service.py.
 */
import { and, desc, eq } from 'drizzle-orm'
import { type DbClient, seasonPoints, seasons, subscriptions } from '../db'
import { SUBSCRIPTION_POINT_MULTIPLIER } from '../db/schema/points'

export type Tier = 'free' | 'pro' | 'premium' | 'enterprise'

const RANK_TIER: Tier[] = ['free', 'pro', 'premium', 'enterprise']
export const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, premium: 2, enterprise: 3 }

/** Subscription-tier swap-fee fraction (0.01 = 1%). Mirrors Python TIER_FEE_RATES. */
export const TIER_FEE_FRACTION: Record<Tier, number> = {
	free: 0.01,
	pro: 0.005,
	premium: 0.003,
	enterprise: 0.001,
}

/** Cross-line season volume (USD) → equivalent tier. Descending; first met wins. */
export const ACTIVITY_BANDS: ReadonlyArray<readonly [number, Tier]> = [
	[500_000, 'enterprise'],
	[100_000, 'premium'],
	[25_000, 'pro'],
]

export function activityBand(volumeUsd: number): Tier {
	for (const [threshold, tier] of ACTIVITY_BANDS) {
		if (volumeUsd >= threshold) return tier
	}
	return 'free'
}

/** Effective tier = max(subscription tier, activity band from season volume). */
export function effectiveTier(subTier: Tier, volumeUsd: number): Tier {
	const band = activityBand(volumeUsd)
	return RANK_TIER[Math.max(TIER_RANK[subTier] ?? 0, TIER_RANK[band] ?? 0)]
}

export function tierFeeFraction(tier: Tier): number {
	return TIER_FEE_FRACTION[tier] ?? TIER_FEE_FRACTION.free
}

function normalizeTier(raw: string | null | undefined): Tier {
	const t = (raw ?? 'free').toLowerCase()
	return (RANK_TIER as string[]).includes(t) ? (t as Tier) : 'free'
}

/** Cross-line traded volume for the active season (USD). 0 if none. */
export async function getSeasonVolumeUsdRaw(db: DbClient, userId: number): Promise<number> {
	const season = (
		await db
			.select({ id: seasons.id })
			.from(seasons)
			.where(eq(seasons.status, 'active'))
			.orderBy(desc(seasons.startsAt))
			.limit(1)
	)[0]
	if (!season) return 0
	const row = (
		await db
			.select({ v: seasonPoints.swapVolumeUsd })
			.from(seasonPoints)
			.where(and(eq(seasonPoints.seasonId, season.id), eq(seasonPoints.userId, userId)))
			.limit(1)
	)[0]
	return row?.v ?? 0
}

/** The user's *active* paid subscription tier (honours expiry). 'free' if none. */
export async function getSubscriptionTierRaw(db: DbClient, userId: number): Promise<Tier> {
	const sub = (
		await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1)
	)[0]
	if (!sub) return 'free'
	if (sub.expiresAt && sub.expiresAt < new Date()) return 'free'
	return normalizeTier(sub.tier)
}

export interface EffectiveTierResult {
	subTier: Tier
	effectiveTier: Tier
	seasonVolumeUsd: number
}

/** Resolve subscription tier + season volume → effective tier, in one shot. */
export async function resolveEffectiveTierRaw(
	db: DbClient,
	userId: number,
): Promise<EffectiveTierResult> {
	const [subTier, seasonVolumeUsd] = await Promise.all([
		getSubscriptionTierRaw(db, userId),
		getSeasonVolumeUsdRaw(db, userId),
	])
	return { subTier, effectiveTier: effectiveTier(subTier, seasonVolumeUsd), seasonVolumeUsd }
}

/** The next band above `volumeUsd`, or null if already at the top. */
export function nextBand(volumeUsd: number): { tier: Tier; threshold: number } | null {
	const ascending = [...ACTIVITY_BANDS].reverse() // pro, premium, enterprise
	for (const [threshold, tier] of ascending) {
		if (volumeUsd < threshold) return { tier, threshold }
	}
	return null
}

export interface VipStatus {
	subscriptionTier: Tier
	activityTier: Tier
	effectiveTier: Tier
	isBoostedByActivity: boolean
	seasonVolumeUsd: number
	pointMultiplier: number
	feeFraction: number
	nextTier: Tier | null
	nextThresholdUsd: number | null
	volumeToNextUsd: number | null
}

/** Full surfacing payload mirroring bot vip_service.get_status. */
export async function getVipStatusRaw(db: DbClient, userId: number): Promise<VipStatus> {
	const { subTier, effectiveTier: eff, seasonVolumeUsd } = await resolveEffectiveTierRaw(db, userId)
	const next = nextBand(seasonVolumeUsd)
	return {
		subscriptionTier: subTier,
		activityTier: activityBand(seasonVolumeUsd),
		effectiveTier: eff,
		isBoostedByActivity: (TIER_RANK[eff] ?? 0) > (TIER_RANK[subTier] ?? 0),
		seasonVolumeUsd,
		pointMultiplier: SUBSCRIPTION_POINT_MULTIPLIER[eff] ?? 1.0,
		feeFraction: tierFeeFraction(eff),
		nextTier: next?.tier ?? null,
		nextThresholdUsd: next?.threshold ?? null,
		volumeToNextUsd: next ? Math.max(0, next.threshold - seasonVolumeUsd) : null,
	}
}
