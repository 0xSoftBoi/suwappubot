import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { requireDb } from '../db'
import { mapErrorToResponse } from '../errors'
import { runEffectEither } from '../runtime'

/**
 * GET /admin/growth — the marketing + sales funnel in one read-only report.
 *
 * Answers the questions the rest of /admin/* cannot: how many people came,
 * where from, how many showed intent, how many became a lead or signed up,
 * and who the latest leads are.
 *
 * Sources (all in the shared Postgres database):
 *  - web_events        first-party page views + funnel events (routes/webEvents.ts)
 *  - support_tickets   enterprise leads, newsletter + mobile-waitlist signups
 *  - waitlist_signups  handle reservations from /reserve
 *  - users             new accounts
 *  - subscriptions     paying customers by tier
 *
 * Timestamps in those tables are naive UTC, so day buckets are UTC days.
 * Mounted under /admin/*, so it inherits admin auth (middleware/adminSessionAuth.ts).
 */
const adminGrowthRoutes = new Hono()

type Row = Record<string, unknown>
const num = (v: unknown): number => {
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null)

/** Events that mean "this visitor showed buying intent". */
const INTENT_EVENTS = ['cta_clicked', 'upgrade_click', 'demo_call_click', 'contact_sales_view']
/** Events that mean "this visitor converted". */
const CONVERSION_EVENTS = [
	'enterprise_lead_submitted',
	'newsletter_subscribed',
	'mobile_waitlist_submitted',
	'waitlist_reserved',
]
const inList = (values: string[]): SQL => sql.join(values.map((v) => sql`${v}`), sql`, `)

/**
 * `context_json` is written from PUBLIC forms. It is valid JSON to Python but
 * not always to Postgres (a \\u0000 escape, NaN, or a lone surrogate all make
 * `::jsonb` throw), so casting it in SQL let one crafted submission fail the
 * whole report. Parse it here instead, one row at a time, and treat anything
 * unreadable as an empty object.
 */
function parseContext(raw: unknown): Record<string, unknown> {
	if (typeof raw !== 'string' || raw.length > 20_000) return {}
	try {
		const parsed: unknown = JSON.parse(raw)
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {}
	} catch {
		return {}
	}
}
/** A short, printable string field from a parsed context object. */
const field = (obj: Record<string, unknown>, key: string, max = 300): string | null => {
	const v = obj[key]
	if (typeof v !== 'string') return null
	// biome-ignore lint/suspicious/noControlRegex: stripping control characters is the point
	const clean = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
	return clean ? clean.slice(0, max) : null
}
const attributionOf = (obj: Record<string, unknown>): Record<string, unknown> => {
	const a = obj.attribution
	return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : {}
}

adminGrowthRoutes.get('/growth', async (c) => {
	const rawDays = parseInt(c.req.query('days') || '30', 10)
	const days = Math.min(Math.max(Number.isNaN(rawDays) ? 30 : rawDays, 1), 90)

	const now = new Date()
	const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
	const windowStart = new Date(todayStart.getTime() - (days - 1) * 86_400_000)
	const prevStart = new Date(windowStart.getTime() - days * 86_400_000)
	const start = windowStart.toISOString()
	const prev = prevStart.toISOString()
	const startDay = start.slice(0, 10)
	const today = todayStart.toISOString().slice(0, 10)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const run = (label: string, query: SQL) =>
				Effect.tryPromise({
					try: async () => (await db.execute(query)) as unknown as Row[],
					catch: (e) => new Error(`${label}: ${e}`),
				})
			// web_events is created by the Python service at boot. Until that has
			// happened the rest of the report must still load.
			const optional = (label: string, query: SQL) =>
				run(label, query).pipe(Effect.catchAll(() => Effect.succeed(null as Row[] | null)))

			const [
				ticketDaily,
				reservationDaily,
				signupDaily,
				previousRows,
				recentLeads,
				paidRows,
				leadSources,
				eventDaily,
				eventTotals,
				topPages,
				topSources,
				topEvents,
				firstEvent,
			] = yield* Effect.all(
				[
					run(
						'leads by day',
						sql`select to_char(created_at::date, 'YYYY-MM-DD') as day, kind, count(*) as n
							from support_tickets
							where created_at >= ${start}::timestamp
								and kind in ('enterprise_lead', 'newsletter', 'mobile_waitlist')
							group by 1, 2`,
					),
					run(
						'reservations by day',
						sql`select to_char(created_at::date, 'YYYY-MM-DD') as day, count(*) as n
							from waitlist_signups where created_at >= ${start}::timestamp group by 1`,
					),
					run(
						'signups by day',
						sql`select to_char(created_at::date, 'YYYY-MM-DD') as day, count(*) as n
							from users where created_at >= ${start}::timestamp group by 1`,
					),
					run(
						'previous period',
						sql`select
							(select count(*) from support_tickets where kind = 'enterprise_lead'
								and created_at >= ${prev}::timestamp and created_at < ${start}::timestamp) as leads,
							(select count(*) from support_tickets where kind = 'newsletter'
								and created_at >= ${prev}::timestamp and created_at < ${start}::timestamp) as newsletter,
							(select count(*) from support_tickets where kind = 'mobile_waitlist'
								and created_at >= ${prev}::timestamp and created_at < ${start}::timestamp) as mobile_waitlist,
							(select count(*) from waitlist_signups
								where created_at >= ${prev}::timestamp and created_at < ${start}::timestamp) as reservations,
							(select count(*) from users
								where created_at >= ${prev}::timestamp and created_at < ${start}::timestamp) as signups`,
					),
					run(
						'recent leads',
						sql`select id, status, created_at, context_json
							from support_tickets
							where kind = 'enterprise_lead'
							order by created_at desc
							limit 50`,
					),
					run(
						'paying customers',
						sql`select tier, count(*) as n from subscriptions
							where tier in ('pro', 'premium', 'enterprise')
								and (expires_at is null or expires_at > now() at time zone 'UTC')
							group by 1`,
					),
					run(
						'lead sources',
						sql`select context_json
							from support_tickets
							where created_at >= ${start}::timestamp
								and kind in ('enterprise_lead', 'newsletter', 'mobile_waitlist')
							order by created_at desc
							limit 5000`,
					),
					optional(
						'visits by day',
						sql`select to_char(created_at::date, 'YYYY-MM-DD') as day,
								count(distinct session_id) as visitors,
								count(*) filter (where name = 'page_view') as page_views
							from web_events where created_at >= ${start}::timestamp group by 1`,
					),
					optional(
						'visit totals',
						sql`select
								count(distinct session_id) filter (where created_at >= ${start}::timestamp) as visitors,
								count(*) filter (where created_at >= ${start}::timestamp and name = 'page_view') as page_views,
								count(distinct session_id) filter (where created_at >= ${start}::timestamp
									and name in (${inList(INTENT_EVENTS)})) as intent,
								count(distinct session_id) filter (where created_at >= ${start}::timestamp
									and name in (${inList(CONVERSION_EVENTS)})) as converted,
								count(distinct session_id) filter (where created_at < ${start}::timestamp) as prev_visitors,
								count(*) filter (where created_at < ${start}::timestamp and name = 'page_view') as prev_page_views
							from web_events where created_at >= ${prev}::timestamp`,
					),
					optional(
						'top pages',
						sql`select path, count(*) as views, count(distinct session_id) as visitors
							from web_events
							where created_at >= ${start}::timestamp and name = 'page_view'
							group by 1 order by 2 desc limit 10`,
					),
					optional(
						'top sources',
						sql`with first_touch as (
								select distinct on (session_id) session_id,
									coalesce(nullif(utm_source, ''), nullif(referrer_host, ''), 'direct') as source
								from web_events
								where created_at >= ${start}::timestamp
								order by session_id, created_at asc
							), converted as (
								select distinct session_id from web_events
								where created_at >= ${start}::timestamp and name in (${inList(CONVERSION_EVENTS)})
							)
							select f.source, count(*) as visitors, count(c.session_id) as conversions
							from first_touch f left join converted c using (session_id)
							group by 1 order by 2 desc limit 8`,
					),
					optional(
						'top events',
						sql`select name, count(*) as n, count(distinct session_id) as visitors
							from web_events
							where created_at >= ${start}::timestamp and name <> 'page_view'
							group by 1 order by 2 desc limit 12`,
					),
					optional('first event', sql`select min(created_at) as first_at from web_events`),
				],
				{ concurrency: 4 },
			)

			// ── Zero-filled daily series ────────────────────────────────────
			const series = new Map<
				string,
				{
					date: string
					visitors: number
					pageViews: number
					leads: number
					newsletter: number
					mobileWaitlist: number
					reservations: number
					signups: number
				}
			>()
			for (let t = windowStart.getTime(); t <= todayStart.getTime(); t += 86_400_000) {
				const date = new Date(t).toISOString().slice(0, 10)
				series.set(date, {
					date,
					visitors: 0,
					pageViews: 0,
					leads: 0,
					newsletter: 0,
					mobileWaitlist: 0,
					reservations: 0,
					signups: 0,
				})
			}
			for (const r of ticketDaily) {
				const day = series.get(String(r.day))
				if (!day) continue
				if (r.kind === 'enterprise_lead') day.leads = num(r.n)
				else if (r.kind === 'newsletter') day.newsletter = num(r.n)
				else if (r.kind === 'mobile_waitlist') day.mobileWaitlist = num(r.n)
			}
			for (const r of reservationDaily) {
				const day = series.get(String(r.day))
				if (day) day.reservations = num(r.n)
			}
			for (const r of signupDaily) {
				const day = series.get(String(r.day))
				if (day) day.signups = num(r.n)
			}
			for (const r of eventDaily ?? []) {
				const day = series.get(String(r.day))
				if (day) {
					day.visitors = num(r.visitors)
					day.pageViews = num(r.page_views)
				}
			}
			const seriesList = [...series.values()]
			const sum = (key: 'leads' | 'newsletter' | 'mobileWaitlist' | 'reservations' | 'signups') =>
				seriesList.reduce((total, day) => total + day[key], 0)

			const visit = eventTotals?.[0]
			const previous = previousRows[0] ?? {}
			const trackingAvailable = eventDaily !== null
			const paidByTier: Record<string, number> = { pro: 0, premium: 0, enterprise: 0 }
			for (const r of paidRows) paidByTier[String(r.tier)] = num(r.n)

			const totals = {
				// Visitors are unique per window, not a sum of daily uniques.
				visitors: num(visit?.visitors),
				pageViews: num(visit?.page_views),
				leads: sum('leads'),
				newsletter: sum('newsletter'),
				mobileWaitlist: sum('mobileWaitlist'),
				reservations: sum('reservations'),
				signups: sum('signups'),
			}
			const conversions = totals.leads + totals.newsletter + totals.mobileWaitlist + totals.reservations

			return {
				days,
				window: { from: startDay, to: today },
				generatedAt: now.toISOString(),
				tracking: {
					available: trackingAvailable,
					firstEventAt: firstEvent?.[0]?.first_at
						? new Date(String(firstEvent[0].first_at)).toISOString()
						: null,
				},
				totals: { ...totals, conversions },
				previous: {
					visitors: num(visit?.prev_visitors),
					pageViews: num(visit?.prev_page_views),
					leads: num(previous.leads),
					newsletter: num(previous.newsletter),
					mobileWaitlist: num(previous.mobile_waitlist),
					reservations: num(previous.reservations),
					signups: num(previous.signups),
					conversions:
						num(previous.leads) +
						num(previous.newsletter) +
						num(previous.mobile_waitlist) +
						num(previous.reservations),
				},
				paidCustomers: {
					total: paidByTier.pro + paidByTier.premium + paidByTier.enterprise,
					byTier: paidByTier,
				},
				// Steps 1-3 are unique visitors from web_events; they nest by
				// construction only loosely (a visitor can convert without a tracked
				// intent event), so the UI presents them as counts, not a strict funnel.
				funnel: [
					{ key: 'visitors', label: 'Visited the site', count: num(visit?.visitors) },
					{ key: 'intent', label: 'Showed interest (clicked a main button or opened the contact form)', count: num(visit?.intent) },
					{ key: 'converted', label: 'Sent in a form', count: num(visit?.converted) },
				],
				series: seriesList,
				topPages: (topPages ?? []).map((r) => ({
					path: String(r.path),
					views: num(r.views),
					visitors: num(r.visitors),
				})),
				topSources: (topSources ?? []).map((r) => ({
					source: String(r.source),
					visitors: num(r.visitors),
					conversions: num(r.conversions),
				})),
				topEvents: (topEvents ?? []).map((r) => ({
					name: String(r.name),
					count: num(r.n),
					visitors: num(r.visitors),
				})),
				leadSources: (() => {
					const counts = new Map<string, number>()
					for (const r of leadSources) {
						const source = field(attributionOf(parseContext(r.context_json)), 'utm_source', 80) ?? 'direct / unknown'
						counts.set(source, (counts.get(source) ?? 0) + 1)
					}
					return [...counts.entries()]
						.sort((x, y) => y[1] - x[1])
						.slice(0, 8)
						.map(([source, count]) => ({ source, count }))
				})(),
				recentLeads: recentLeads.map((r) => {
					const c = parseContext(r.context_json)
					const attribution = attributionOf(c)
					return {
						id: num(r.id),
						status: str(r.status) ?? 'open',
						createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
						name: field(c, 'name'),
						company: field(c, 'company'),
						email: field(c, 'email', 320),
						country: field(c, 'country'),
						monthlyVolume: field(c, 'monthly_volume'),
						telegram: field(c, 'telegram'),
						useCase: field(c, 'use_case', 2000),
						source: field(attribution, 'utm_source', 80) ?? field(attribution, 'referrer', 200),
						campaign: field(attribution, 'utm_campaign', 80),
					}
				}),
			}
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 400)
	}
	return c.json({ success: true, ...result.right })
})

// GET /admin/me — who is signed in, for the dashboard header.
adminGrowthRoutes.get('/me', (c) => {
	const email = c.get('adminEmail')
	return c.json({ success: true, via: email ? 'session' : 'key', email: email ?? null })
})

export { adminGrowthRoutes }
