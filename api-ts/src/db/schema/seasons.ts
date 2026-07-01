import {
	boolean,
	doublePrecision,
	index,
	integer,
	pgTable,
	serial,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core'
import type { LevelName } from './points'
import { users } from './users'

// ============================================================================
// Season tables — mirror Python SQLAlchemy DDL EXACTLY (snake_case db columns).
// The Python stack owns production DDL (database/db.py create_all). DOUBLE
// PRECISION columns map to drizzle `doublePrecision`, NOT `real`.
// ============================================================================

// `seasons` — one row per convertible-points season.
export const seasons = pgTable('seasons', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 100 }).notNull(),
	slug: varchar('slug', { length: 50 }).notNull().unique(),
	// upcoming | active | ended | settled
	status: varchar('status', { length: 20 }).default('upcoming').notNull(),
	startsAt: timestamp('starts_at').notNull(),
	endsAt: timestamp('ends_at').notNull(),
	tokenPool: doublePrecision('token_pool').default(0).notNull(),
	tokenSymbol: varchar('token_symbol', { length: 20 }).default('SUWP').notNull(),
	description: varchar('description', { length: 255 }),
	// 1-based emission-schedule index; drives season_pool(season_index) and the
	// weather/quarter identity via seasonSchedule(season_index).
	seasonIndex: integer('season_index').default(1).notNull(),
	// Official fiscal-quarter label, e.g. "Q3 2026". Each season is one calendar
	// quarter; the weather season lives in `name` (e.g. "Summer 2026").
	quarter: varchar('quarter', { length: 16 }),
	// Denominator set at settle time (nullable until settled).
	totalPointsSnapshot: doublePrecision('total_points_snapshot'),
	// Realized fee revenue (USD) for this season; set at settle time.
	realizedFeeRevenueUsd: doublePrecision('realized_fee_revenue_usd'),
	settledAt: timestamp('settled_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Season = typeof seasons.$inferSelect
export type NewSeason = typeof seasons.$inferInsert

// `season_points` — live per-user-per-season accrual.
export const seasonPoints = pgTable(
	'season_points',
	{
		id: serial('id').primaryKey(),
		seasonId: integer('season_id')
			.notNull()
			.references(() => seasons.id),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		// Post-multiplier convertible points.
		points: doublePrecision('points').default(0).notNull(),
		// Pre-multiplier (audit).
		basePoints: doublePrecision('base_points').default(0).notNull(),
		// Season volume (display + anti-farm).
		swapVolumeUsd: doublePrecision('swap_volume_usd').default(0).notNull(),
		// Season referral points (for cap).
		referralPoints: doublePrecision('referral_points').default(0).notNull(),
		// Rolling per-UTC-day counter.
		dailyPointsAwarded: doublePrecision('daily_points_awarded').default(0).notNull(),
		// 'YYYY-MM-DD' UTC of the daily counter.
		dailyWindowDate: varchar('daily_window_date', { length: 10 }),
		// Realized fees paid by the user this season (USD) — fee-based points + revenue audit.
		feePaidUsd: doublePrecision('fee_paid_usd').default(0).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => ({
		seasonUserIdx: uniqueIndex('ux_season_points_season_user').on(
			table.seasonId,
			table.userId,
		),
	}),
)

export type SeasonPoints = typeof seasonPoints.$inferSelect
export type NewSeasonPoints = typeof seasonPoints.$inferInsert

// `season_snapshots` — immutable, written at settle.
export const seasonSnapshots = pgTable(
	'season_snapshots',
	{
		id: serial('id').primaryKey(),
		seasonId: integer('season_id')
			.notNull()
			.references(() => seasons.id),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		finalPoints: doublePrecision('final_points').notNull(),
		rank: integer('rank'),
		// Denominator at settle.
		totalPoints: doublePrecision('total_points').notNull(),
		tokenPool: doublePrecision('token_pool').notNull(),
		// final_points / total_points * token_pool.
		tokenAllocation: doublePrecision('token_allocation').notNull(),
		tokenSymbol: varchar('token_symbol', { length: 20 }).default('SUWP').notNull(),
		claimed: boolean('claimed').default(false).notNull(),
		claimedAt: timestamp('claimed_at'),
		claimTxHash: varchar('claim_tx_hash', { length: 120 }),
		walletAddress: varchar('wallet_address', { length: 120 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		seasonUserIdx: uniqueIndex('ux_season_snapshots_season_user').on(
			table.seasonId,
			table.userId,
		),
		seasonIdIdx: index('season_snapshots_season_id_idx').on(table.seasonId),
		userIdIdx: index('season_snapshots_user_id_idx').on(table.userId),
	}),
)

export type SeasonSnapshot = typeof seasonSnapshots.$inferSelect
export type NewSeasonSnapshot = typeof seasonSnapshots.$inferInsert

// ============================================================================
// Anti-farm constants (identical in both stacks — keep in sync with Python).
// ============================================================================

// Swaps below this USD notional earn 0 season points (kills dust wash trades).
export const MIN_SWAP_USD_FOR_SEASON_POINTS = 5.0
// Max season points one user accrues per UTC day.
export const DAILY_SEASON_POINT_CAP = 5000.0
// Max season referral points per user per season.
export const REFERRAL_SEASON_POINT_CAP = 10000.0

// Actions that accrue season points. EXCLUDES: level_up (meta),
// redemption (spend/negative), twitter_share (stubbed/unverifiable).
export const SEASON_POINT_ACTION_ALLOWLIST: ReadonlySet<string> = new Set([
	'swap',
	'first_swap_daily',
	'checkin',
	'streak_bonus',
	'referral_signup',
	'referral_first_swap',
	'copy_trade',
	'milestone',
])

// Actions that count toward the referral cap.
export const REFERRAL_SEASON_ACTIONS: ReadonlySet<string> = new Set([
	'referral_signup',
	'referral_first_swap',
])

// ============================================================================
// Engagement multipliers (identical in both stacks).
// ============================================================================

export const LEVEL_MULTIPLIER: Record<LevelName, number> = {
	bronze: 1.0,
	silver: 1.05,
	gold: 1.1,
	platinum: 1.2,
	diamond: 1.35,
}

// Hard cap on the combined multiplier.
export const COMBINED_MULTIPLIER_CAP = 1.75

// streak multiplier = 1 + min(daily_streak, 30) * 0.01 (up to +0.30 at 30 days)
export function streakMultiplier(streak: number): number {
	return 1 + Math.min(Math.max(streak, 0), 30) * 0.01
}

// combined = min(level_mult * streak_mult, 1.75)
export function combinedMultiplier(level: LevelName, streak: number): number {
	const levelMult = LEVEL_MULTIPLIER[level] ?? 1.0
	return Math.min(levelMult * streakMultiplier(streak), COMBINED_MULTIPLIER_CAP)
}

// ============================================================================
// Committed tokenomics (identical in both stacks — full model in
// docs/economics/SEASONS_TOKENOMICS.md). Disinflationary emission schedule over
// SEASON_COUNT_N seasons that allocates exactly PROGRAM_ALLOCATION_PCT of supply.
// ============================================================================

export const TOKEN_MAX_SUPPLY = 1_000_000_000
// Fraction of max supply reserved for the seasons program (A = 300_000_000).
export const PROGRAM_ALLOCATION_PCT = 0.3
// Total number of seasons over which the program allocation is emitted.
export const SEASON_COUNT_N = 8
// Geometric decay factor between consecutive season pools.
export const EMISSION_DECAY_DELTA = 0.75
// Revenue-cap multiple (γ) — groundwork; not enforced here.
export const REVENUE_CAP_MULTIPLE_GAMMA = 2.0
// Season points granted per USD of swap fee paid (the Tullock-proof core).
export const SEASON_POINTS_PER_FEE_USD = 100.0

// Total program token allocation = A.
export function programAllocation(): number {
	return PROGRAM_ALLOCATION_PCT * TOKEN_MAX_SUPPLY
}

// season_pool(k) = A * (1-δ)/(1-δ^N) * δ^(k-1) for 1-based k in [1, N]; 0 for k>N.
export function seasonPool(k: number): number {
	const kk = Math.floor(k)
	if (kk < 1) return seasonPool(1)
	if (kk > SEASON_COUNT_N) return 0
	const A = programAllocation()
	const delta = EMISSION_DECAY_DELTA
	const normalizer = (1 - delta) / (1 - delta ** SEASON_COUNT_N)
	return A * normalizer * delta ** (kk - 1)
}

// season_inflation(k, circPrev) = season_pool(k)/circPrev, or null if circPrev<=0.
// circPrev = sum of pools for seasons 1..k-1.
export function seasonInflation(k: number, circPrev: number): number | null {
	if (circPrev <= 0) return null
	return seasonPool(k) / circPrev
}

// ============================================================================
// Seasonal calendar — weather-named seasons aligned to fiscal quarters.
// season_index 1 == Summer 2026 == Q3 2026. Seasons cycle Summer→Fall→Winter→
// Spring on calendar-quarter boundaries, so each season IS one official
// reporting quarter (Q1..Q4). 8 seasons == 8 quarters == 2 years.
// Keep IN SYNC with bot/models/seasons.py.
// ============================================================================

// Quarter number (1..4) -> weather-season name. Q1=Jan-Mar … Q4=Oct-Dec.
export const WEATHER_BY_QUARTER: Record<number, string> = {
	1: 'Winter',
	2: 'Spring',
	3: 'Summer',
	4: 'Fall',
}
// First (1-based) month of each calendar quarter.
const QUARTER_START_MONTH: Record<number, number> = { 1: 1, 2: 4, 3: 7, 4: 10 }
// Anchor: season_index 1 == calendar Q3 2026 (Summer). Drives the weather name and
// the Jul–Sep window — NOT the reporting label (that is the company fiscal quarter).
const ANCHOR_QUARTER_ABS = 2026 * 4 + (3 - 1)
// Company FISCAL calendar: fiscal year starts at the summer launch, so season_index
// 1 == Q1 FY26 (Summer 2026); quarters cycle Q1..Q4, new fiscal year each summer.
const FISCAL_YEAR_ANCHOR = 2026

// (year, calendar quarter 1..4) for a 1-based season_index — weather name + window.
function quarterOf(seasonIndex: number): { year: number; quarter: number } {
	const k = Math.max(1, Math.floor(seasonIndex) || 1)
	const qAbs = ANCHOR_QUARTER_ABS + (k - 1)
	return { year: Math.floor(qAbs / 4), quarter: (qAbs % 4) + 1 }
}

// (fiscalYear, fiscalQuarter 1..4) for a 1-based season_index. Beta == Q1 FY26.
function fiscalQuarter(seasonIndex: number): { fy: number; fq: number } {
	const k = Math.max(1, Math.floor(seasonIndex) || 1)
	return { fy: FISCAL_YEAR_ANCHOR + Math.floor((k - 1) / 4), fq: ((k - 1) % 4) + 1 }
}

export function weatherForIndex(seasonIndex: number): string {
	return WEATHER_BY_QUARTER[quarterOf(seasonIndex).quarter]
}

// Official company fiscal-quarter label, e.g. "Q1 FY26".
export function quarterLabelForIndex(seasonIndex: number): string {
	const { fy, fq } = fiscalQuarter(seasonIndex)
	return `Q${fq} FY${String(fy % 100).padStart(2, '0')}`
}

// Committed identity for season k (1-based): weather name, official quarter label,
// quarter-aligned window (ends = first day of next quarter, exclusive), and pool.
export function seasonSchedule(k: number): NewSeason {
	const { year, quarter } = quarterOf(k)
	const weather = WEATHER_BY_QUARTER[quarter]
	const startsAt = new Date(Date.UTC(year, QUARTER_START_MONTH[quarter] - 1, 1))
	const next = quarterOf(Math.floor(k) + 1)
	const endsAt = new Date(Date.UTC(next.year, QUARTER_START_MONTH[next.quarter] - 1, 1))
	return {
		name: `${weather} ${year}`,
		slug: `${year}-q${quarter}-${weather.toLowerCase()}`,
		status: 'upcoming',
		seasonIndex: Math.floor(k),
		quarter: quarterLabelForIndex(k),
		startsAt,
		endsAt,
		tokenPool: seasonPool(k),
		tokenSymbol: 'SUWP',
	}
}

// First convertible-points season seed: Summer 2026 == Q3 2026, schedule-derived.
// token_pool ≈ 83_343_790 (season_pool(1)), NOT a flat grant. Idempotent on slug.
export const SEED_SEASON: NewSeason = {
	...seasonSchedule(1),
	status: 'active',
	description:
		'Summer 2026 (Q1 FY26) — first convertible points season. Points convert to SUWP pro-rata after TGE.',
}
