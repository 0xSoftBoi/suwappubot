/**
 * Card rule engine (M6). PURE and DETERMINISTIC: no clock, no DB, no network.
 * The caller passes `now` and the spend history; the engine returns a decision
 * naming the rule that decided. Amounts are integer minor units of the CARD
 * currency (e.g. cents) as bigint.
 *
 * MONEY-PATH: this decides whether an authorization is approved.
 */
import { Schema } from '@effect/schema'
import { Either } from 'effect'

// ---------------------------------------------------------------- schema

const Amount = Schema.Union(
	Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
	Schema.String.pipe(Schema.pattern(/^\d{1,30}$/)),
)
const WindowTs = Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/))
const Tz = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64))
const Str = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120))
const Mcc = Schema.String.pipe(Schema.pattern(/^\d{4}(-\d{4})?$/))
const Country = Schema.String.pipe(Schema.pattern(/^[A-Za-z]{2}$/))
const Caps = Schema.Struct({
	dailyMinor: Schema.optional(Amount),
	weeklyMinor: Schema.optional(Amount),
	monthlyMinor: Schema.optional(Amount),
})

export const CardRulesSchema = Schema.Struct({
	/** Authorization allowed only inside one of these windows (wall-clock in `timezone`). Date-only end is inclusive. */
	activeWindows: Schema.optional(
		Schema.Array(Schema.Struct({ start: WindowTs, end: WindowTs, timezone: Schema.optional(Tz) })).pipe(Schema.maxItems(24)),
	),
	merchantAllow: Schema.optional(Schema.Array(Str).pipe(Schema.maxItems(100))),
	merchantBlock: Schema.optional(Schema.Array(Str).pipe(Schema.maxItems(100))),
	/** 4-digit MCC or inclusive range "3000-3299". */
	mccAllow: Schema.optional(Schema.Array(Mcc).pipe(Schema.maxItems(200))),
	mccBlock: Schema.optional(Schema.Array(Mcc).pipe(Schema.maxItems(200))),
	countryAllow: Schema.optional(Schema.Array(Country).pipe(Schema.maxItems(250))),
	countryBlock: Schema.optional(Schema.Array(Country).pipe(Schema.maxItems(250))),
	perTxCapMinor: Schema.optional(Amount),
	dailyCapMinor: Schema.optional(Amount),
	weeklyCapMinor: Schema.optional(Amount),
	monthlyCapMinor: Schema.optional(Amount),
	/** IANA zone used for daily/weekly(Mon)/monthly cap boundaries. Default UTC. */
	capTimezone: Schema.optional(Tz),
	singleUse: Schema.optional(Schema.Boolean),
	autoFreezeAfterDeclines: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 100))),
	/** Aggregate across all of the account owner's cards with the same member_id. */
	memberCaps: Schema.optional(Caps),
	/** Aggregate across all of the account owner's cards with the same team_id. */
	teamCaps: Schema.optional(Caps),
})

export interface Window {
	start: string
	end: string
	timezone: string
}
export interface PeriodCaps {
	dailyMinor?: bigint
	weeklyMinor?: bigint
	monthlyMinor?: bigint
}
export interface NormalizedRules {
	activeWindows: Window[]
	merchantAllow: string[]
	merchantBlock: string[]
	mccAllow: string[]
	mccBlock: string[]
	countryAllow: string[]
	countryBlock: string[]
	perTxCapMinor?: bigint
	dailyCapMinor?: bigint
	weeklyCapMinor?: bigint
	monthlyCapMinor?: bigint
	capTimezone: string
	singleUse: boolean
	autoFreezeAfterDeclines?: number
	memberCaps?: PeriodCaps
	teamCaps?: PeriodCaps
}

const big = (v: number | string | undefined): bigint | undefined => (v === undefined ? undefined : BigInt(v))
const validTz = (tz: string): boolean => {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz })
		return true
	} catch {
		return false
	}
}
const normCaps = (c?: { dailyMinor?: number | string; weeklyMinor?: number | string; monthlyMinor?: number | string }): PeriodCaps | undefined => {
	if (!c) return undefined
	const out: PeriodCaps = {}
	const d = big(c.dailyMinor)
	const w = big(c.weeklyMinor)
	const m = big(c.monthlyMinor)
	if (d !== undefined) out.dailyMinor = d
	if (w !== undefined) out.weeklyMinor = w
	if (m !== undefined) out.monthlyMinor = m
	return out
}
const normMerchant = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Validate + normalize untrusted JSON. Left = human-readable problem. */
export function parseRules(input: unknown): Either.Either<NormalizedRules, string> {
	const dec = Schema.decodeUnknownEither(CardRulesSchema, { onExcessProperty: 'error' })(input ?? {})
	if (Either.isLeft(dec)) return Either.left(`Invalid card rules: ${String(dec.left.message).split('\n').slice(0, 4).join(' | ')}`)
	const r = dec.right
	const capTimezone = r.capTimezone ?? 'UTC'
	if (!validTz(capTimezone)) return Either.left(`Invalid capTimezone: ${capTimezone}`)
	const windows: Window[] = []
	for (const w of r.activeWindows ?? []) {
		const tz = w.timezone ?? 'UTC'
		if (!validTz(tz)) return Either.left(`Invalid window timezone: ${tz}`)
		const start = w.start.length === 10 ? `${w.start}T00:00:00` : w.start.length === 16 ? `${w.start}:00` : w.start
		const end = w.end.length === 10 ? `${w.end}T23:59:59` : w.end.length === 16 ? `${w.end}:59` : w.end
		if (Number.isNaN(Date.parse(`${start}Z`)) || Number.isNaN(Date.parse(`${end}Z`)))
			return Either.left(`Invalid window dates: ${w.start}..${w.end}`)
		if (start > end) return Either.left(`Window start after end: ${w.start}..${w.end}`)
		windows.push({ start, end, timezone: tz })
	}
	for (const m of [...(r.mccAllow ?? []), ...(r.mccBlock ?? [])]) {
		const [a, b] = m.split('-')
		if (b !== undefined && Number(a) > Number(b)) return Either.left(`Invalid MCC range: ${m}`)
	}
	const out: NormalizedRules = {
		activeWindows: windows,
		merchantAllow: (r.merchantAllow ?? []).map(normMerchant),
		merchantBlock: (r.merchantBlock ?? []).map(normMerchant),
		mccAllow: [...(r.mccAllow ?? [])],
		mccBlock: [...(r.mccBlock ?? [])],
		countryAllow: (r.countryAllow ?? []).map((c) => c.toUpperCase()),
		countryBlock: (r.countryBlock ?? []).map((c) => c.toUpperCase()),
		capTimezone,
		singleUse: r.singleUse ?? false,
	}
	const pt = big(r.perTxCapMinor)
	const dc = big(r.dailyCapMinor)
	const wc = big(r.weeklyCapMinor)
	const mc = big(r.monthlyCapMinor)
	if (pt !== undefined) out.perTxCapMinor = pt
	if (dc !== undefined) out.dailyCapMinor = dc
	if (wc !== undefined) out.weeklyCapMinor = wc
	if (mc !== undefined) out.monthlyCapMinor = mc
	if (r.autoFreezeAfterDeclines !== undefined) out.autoFreezeAfterDeclines = r.autoFreezeAfterDeclines
	const mcap = normCaps(r.memberCaps)
	const tcap = normCaps(r.teamCaps)
	if (mcap) out.memberCaps = mcap
	if (tcap) out.teamCaps = tcap
	return Either.right(out)
}

/** JSON-safe form for storage in `bank_cards.rules` (bigints -> digit strings). */
export function serializeRules(n: NormalizedRules): Record<string, unknown> {
	const s = (v?: bigint) => (v === undefined ? undefined : v.toString())
	const caps = (c?: PeriodCaps) =>
		c ? { dailyMinor: s(c.dailyMinor), weeklyMinor: s(c.weeklyMinor), monthlyMinor: s(c.monthlyMinor) } : undefined
	const raw: Record<string, unknown> = {
		activeWindows: n.activeWindows.length ? n.activeWindows : undefined,
		merchantAllow: n.merchantAllow.length ? n.merchantAllow : undefined,
		merchantBlock: n.merchantBlock.length ? n.merchantBlock : undefined,
		mccAllow: n.mccAllow.length ? n.mccAllow : undefined,
		mccBlock: n.mccBlock.length ? n.mccBlock : undefined,
		countryAllow: n.countryAllow.length ? n.countryAllow : undefined,
		countryBlock: n.countryBlock.length ? n.countryBlock : undefined,
		perTxCapMinor: s(n.perTxCapMinor),
		dailyCapMinor: s(n.dailyCapMinor),
		weeklyCapMinor: s(n.weeklyCapMinor),
		monthlyCapMinor: s(n.monthlyCapMinor),
		capTimezone: n.capTimezone,
		singleUse: n.singleUse || undefined,
		autoFreezeAfterDeclines: n.autoFreezeAfterDeclines,
		memberCaps: caps(n.memberCaps),
		teamCaps: caps(n.teamCaps),
	}
	return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined))
}

// ---------------------------------------------------------------- time helpers

export interface LocalParts {
	y: number
	m: number
	d: number
	hh: number
	mm: number
	ss: number
}

export function localParts(ms: number, timeZone: string): LocalParts {
	const f = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	})
	const p: Record<string, number> = {}
	for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value)
	return { y: p.year!, m: p.month!, d: p.day!, hh: p.hour!, mm: p.minute!, ss: p.second! }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
export const localIso = (p: LocalParts): string => `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}`

export interface BucketKeys {
	day: string
	/** Monday (local) of the ISO week. */
	week: string
	month: string
}

export function bucketKeys(ms: number, timeZone: string): BucketKeys {
	const p = localParts(ms, timeZone)
	const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
	const monday = new Date(Date.UTC(p.y, p.m - 1, p.d - ((dow + 6) % 7)))
	return {
		day: `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`,
		week: `${pad(monday.getUTCFullYear(), 4)}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`,
		month: `${pad(p.y, 4)}-${pad(p.m)}`,
	}
}

// ---------------------------------------------------------------- evaluation

export interface Spend {
	/** Epoch ms of the hold/capture. */
	at: number
	/** Net spend in card-currency minor units (captures + active holds; refunds negative). */
	amountMinor: bigint
}

export interface AuthInput {
	now: number
	amountMinor: bigint
	merchantName?: string | null
	mcc?: string | null
	country?: string | null
	/** Non-declined authorizations this card has already had (for single-use). */
	priorUseCount: number
	cardHistory: Spend[]
	memberHistory?: Spend[]
	teamHistory?: Spend[]
}

export type RuleId =
	| 'single_use'
	| 'window'
	| 'merchant_block'
	| 'merchant_allow'
	| 'mcc_block'
	| 'mcc_allow'
	| 'country_block'
	| 'country_allow'
	| 'per_tx_cap'
	| 'daily_cap'
	| 'weekly_cap'
	| 'monthly_cap'
	| 'member_daily_cap'
	| 'member_weekly_cap'
	| 'member_monthly_cap'
	| 'team_daily_cap'
	| 'team_weekly_cap'
	| 'team_monthly_cap'

export interface Violation {
	rule: RuleId
	reason: string
}
export interface RuleDecision {
	approved: boolean
	/** Rule that decided; 'approved' when nothing objected. */
	decidedBy: RuleId | 'approved'
	reason: string
	/** Every rule that objected (first is the decider). */
	violations: Violation[]
}

const mccMatches = (list: string[], mcc: string): boolean =>
	list.some((e) => {
		const [a, b] = e.split('-')
		const n = Number(mcc)
		return b === undefined ? a === mcc : n >= Number(a) && n <= Number(b)
	})

const sumIn = (h: Spend[] | undefined, key: 'day' | 'week' | 'month', nowKeys: BucketKeys, tz: string): bigint => {
	let s = 0n
	for (const e of h ?? []) if (bucketKeys(e.at, tz)[key] === nowKeys[key]) s += e.amountMinor
	return s
}

export function evaluateAuthorization(rules: NormalizedRules, a: AuthInput): RuleDecision {
	const v: Violation[] = []
	const push = (rule: RuleId, reason: string) => v.push({ rule, reason })

	if (rules.singleUse && a.priorUseCount > 0) push('single_use', 'Single-use card has already been used')

	if (rules.activeWindows.length) {
		const inside = rules.activeWindows.some((w) => {
			const local = localIso(localParts(a.now, w.timezone))
			return local >= w.start && local <= w.end
		})
		if (!inside) push('window', 'Outside every active date window')
	}

	const merchant = a.merchantName ? normMerchant(a.merchantName) : ''
	const hit = (list: string[]) => list.some((e) => merchant.includes(e))
	if (rules.merchantBlock.length && hit(rules.merchantBlock)) push('merchant_block', `Merchant "${a.merchantName}" is blocked`)
	if (rules.merchantAllow.length && !hit(rules.merchantAllow)) push('merchant_allow', `Merchant "${a.merchantName ?? 'unknown'}" is not on the allowlist`)

	if (rules.mccBlock.length && a.mcc && mccMatches(rules.mccBlock, a.mcc)) push('mcc_block', `MCC ${a.mcc} is blocked`)
	if (rules.mccAllow.length && !(a.mcc && mccMatches(rules.mccAllow, a.mcc)))
		push('mcc_allow', `MCC ${a.mcc ?? 'unknown'} is not on the allowlist`)

	const country = a.country ? a.country.toUpperCase() : null
	if (rules.countryBlock.length && country && rules.countryBlock.includes(country)) push('country_block', `Country ${country} is blocked`)
	if (rules.countryAllow.length && !(country && rules.countryAllow.includes(country)))
		push('country_allow', `Country ${country ?? 'unknown'} is not on the allowlist`)

	if (rules.perTxCapMinor !== undefined && a.amountMinor > rules.perTxCapMinor)
		push('per_tx_cap', `Amount ${a.amountMinor} exceeds per-transaction cap ${rules.perTxCapMinor}`)

	const tz = rules.capTimezone
	const nowKeys = bucketKeys(a.now, tz)
	const cap = (
		prefix: '' | 'member_' | 'team_',
		hist: Spend[] | undefined,
		caps: { d?: bigint; w?: bigint; m?: bigint },
	) => {
		const rows: Array<['day' | 'week' | 'month', bigint | undefined, string]> = [
			['day', caps.d, 'daily'],
			['week', caps.w, 'weekly'],
			['month', caps.m, 'monthly'],
		]
		for (const [k, limit, label] of rows) {
			if (limit === undefined) continue
			const spent = sumIn(hist, k, nowKeys, tz)
			if (spent + a.amountMinor > limit)
				push(`${prefix}${label === 'daily' ? 'daily' : label === 'weekly' ? 'weekly' : 'monthly'}_cap` as RuleId, `${prefix ? prefix.slice(0, -1) + ' ' : ''}${label} cap ${limit} would be exceeded (spent ${spent} + ${a.amountMinor})`)
		}
	}
	cap('', a.cardHistory, { d: rules.dailyCapMinor, w: rules.weeklyCapMinor, m: rules.monthlyCapMinor })
	if (rules.memberCaps) cap('member_', a.memberHistory, { d: rules.memberCaps.dailyMinor, w: rules.memberCaps.weeklyMinor, m: rules.memberCaps.monthlyMinor })
	if (rules.teamCaps) cap('team_', a.teamHistory, { d: rules.teamCaps.dailyMinor, w: rules.teamCaps.weeklyMinor, m: rules.teamCaps.monthlyMinor })

	const first = v[0]
	return first
		? { approved: false, decidedBy: first.rule, reason: first.reason, violations: v }
		: { approved: true, decidedBy: 'approved', reason: 'All rules passed', violations: [] }
}

/** True when this (just-recorded) decline should freeze the card. `streakAfter` includes this decline. */
export const shouldAutoFreeze = (rules: NormalizedRules, streakAfter: number): boolean =>
	rules.autoFreezeAfterDeclines !== undefined && streakAfter >= rules.autoFreezeAfterDeclines

// ---------------------------------------------------------------- native mirror

export interface NativeControls {
	/** Card-currency minor units. */
	perAuthorizationMinor?: bigint
	dailyMinor?: bigint
	weeklyMinor?: bigint
	monthlyMinor?: bigint
	allowedCountries?: string[]
	blockedCountries?: string[]
}

/**
 * Enforceable subset to mirror into the provider (defence in depth). The provider
 * must never be STRICTER than our engine: period caps are mirrored only when our
 * boundary is UTC (Stripe's intervals are UTC), and MCC/merchant/window/member rules
 * are NOT mirrored (provider uses category names / has no wall-clock windows).
 */
export function toNativeControls(r: NormalizedRules): NativeControls {
	const n: NativeControls = {}
	if (r.perTxCapMinor !== undefined) n.perAuthorizationMinor = r.perTxCapMinor
	if (r.capTimezone === 'UTC') {
		if (r.dailyCapMinor !== undefined) n.dailyMinor = r.dailyCapMinor
		if (r.weeklyCapMinor !== undefined) n.weeklyMinor = r.weeklyCapMinor
		if (r.monthlyCapMinor !== undefined) n.monthlyMinor = r.monthlyCapMinor
	}
	if (r.countryAllow.length) n.allowedCountries = r.countryAllow
	if (r.countryBlock.length) n.blockedCountries = r.countryBlock
	return n
}
