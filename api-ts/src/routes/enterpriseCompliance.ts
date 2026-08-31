/**
 * GET /enterprise/orgs/:orgId/compliance/summary — KYT/compliance screening
 *   decision counts (compliance-api node, docs/plans/enterprise-dashboard.md).
 * GET /enterprise/orgs/:orgId/compliance/events — paginated screening events.
 *
 * Split into its own file for the same reason as enterpriseTransactions.ts /
 * enterpriseAudit.ts (enterprise.ts is already 1000+ lines); shares
 * `resolveMembership` from enterprise.ts and is mounted under the same
 * `/enterprise` prefix in app.ts (Hono supports multiple `app.route()` calls
 * at one prefix — see routes/index.ts).
 *
 * DATA-SOURCE: `screeningEvents` (db/schema/screening.ts) — PYTHON-OWNED
 * table written by bot.services.compliance.screening_events at the swap and
 * withdrawal compliance gates. See that module's docstring for exactly when
 * a row is written and its (deliberately best-effort) persistence guarantee.
 *
 * ORG SCOPING: screening events for individual (non-org) users have no
 * `orgId` — the withdrawal call site in particular never has one in scope
 * (pooled custodial hot wallet, no user context — see screening_events.py).
 * So org scoping is NOT a plain `orgId = :orgId` filter: it is `orgId
 * matches OR userId is one of this org's member ids`, via a LEFT-style OR
 * over an `inArray` on `organizationMembers.userId` for this org. An org
 * with zero members still correctly returns zero rows (no accidental
 * "match everything" from an empty IN-list, mirrored from
 * enterpriseTransactions.ts).
 *
 * MODE SOURCE: `compliance_mode` is a python `bot/config/settings.py`
 * env-only setting — api-ts has no DB-backed copy of it to read directly.
 * `summary.mode` is therefore derived from the most recent screening event
 * in the window (best-effort proxy for "what mode is active right now"),
 * with `summary.modeSource: 'observed_from_events' | 'no_recent_events'`
 * telling the caller how to interpret it — never claim a live env read we
 * don't have.
 *
 * Roles: both endpoints are admin+ only (owner, admin) — screening events
 * can reveal counterparty addresses and per-member sanctions hits, so this
 * follows the audit-log role gate, not the wider transactions/treasury one.
 */
import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { requireDb, organizationMembers, screeningEvents } from '../db'
import { mapErrorToResponse } from '../errors'
import { flexAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { resolveMembership } from './enterprise'

export const enterpriseComplianceRoutes = new Hono()

enterpriseComplianceRoutes.use('*', flexAuth())

const ADMIN_ROLES = ['owner', 'admin']

function parseIntParam(raw: string | undefined, def: number, max: number): number {
	if (!raw) return def
	const parsed = parseInt(raw, 10)
	if (!Number.isFinite(parsed) || parsed < 0) return def
	return Math.min(parsed, max)
}

function parseDateParam(raw: string | undefined): Date | null {
	if (!raw) return null
	const d = new Date(raw)
	return Number.isNaN(d.getTime()) ? null : d
}

function csvEscape(value: unknown): string {
	if (value === null || value === undefined) return ''
	let s = String(value)
	// Neutralize spreadsheet formula injection (=, +, -, @ leading a cell).
	if (/^[=+\-@]/.test(s)) s = `'${s}`
	if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
	return s
}

const CSV_MAX_ROWS = 5000

/** Org-scope predicate: orgId match OR the screened user is an org member. */
// biome-ignore-start: `db` is the Drizzle client yielded from the `requireDb`
// Effect layer; typing it precisely here would require exporting that
// layer's internal type, which no other route file does either.
async function orgScopeCondition(db: any, orgId: string): Promise<SQL | null> {
	const memberRows = await db
		.select({ userId: organizationMembers.userId })
		.from(organizationMembers)
		.where(eq(organizationMembers.organizationId, orgId))
	const memberIds = memberRows.map((m: { userId: number }) => m.userId)

	const orgMatch = eq(screeningEvents.orgId, orgId)
	if (memberIds.length === 0) return orgMatch
	// Member-based matching only applies to rows NOT tagged with an org —
	// otherwise a user in two orgs would leak org B's tagged rows to org A.
	return (
		or(orgMatch, and(inArray(screeningEvents.userId, memberIds), isNull(screeningEvents.orgId))) ??
		orgMatch
	)
}

// ─── GET /enterprise/orgs/:orgId/compliance/summary ─────────────────────────
//
// Counts by decision, by reason, and by mode over a `?days=` window (default
// 30, max 365). Also reports the mode observed on the most recent event in
// the window (see MODE SOURCE note above).
enterpriseComplianceRoutes.get('/orgs/:orgId/compliance/summary', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Not an admin of this organization' }, 403)
	const orgId = membership.orgId

	const days = parseIntParam(c.req.query('days'), 30, 365)
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const scope = yield* Effect.tryPromise({
				try: () => orgScopeCondition(db, orgId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!scope) return { byDecision: [], byReason: [], byMode: [], recentMode: null }

			const where = and(scope, gte(screeningEvents.createdAt, since))

			const [byDecision, byReason, byMode, recent] = yield* Effect.all([
				Effect.tryPromise({
					try: () =>
						db
							.select({
								decision: screeningEvents.decision,
								count: sql<number>`cast(count(*) as int)`,
							})
							.from(screeningEvents)
							.where(where)
							.groupBy(screeningEvents.decision),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({
								reason: screeningEvents.reason,
								count: sql<number>`cast(count(*) as int)`,
							})
							.from(screeningEvents)
							.where(where)
							.groupBy(screeningEvents.reason),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({
								mode: screeningEvents.mode,
								count: sql<number>`cast(count(*) as int)`,
							})
							.from(screeningEvents)
							.where(where)
							.groupBy(screeningEvents.mode),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({ mode: screeningEvents.mode, createdAt: screeningEvents.createdAt })
							.from(screeningEvents)
							.where(where)
							.orderBy(desc(screeningEvents.createdAt))
							.limit(1),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
			])

			return { byDecision, byReason, byMode, recentMode: recent[0]?.mode ?? null }
		}),
	)

	if (Either.isLeft(result)) {
		const { status: httpStatus, body } = mapErrorToResponse(result.left)
		return c.json(body, httpStatus as 200)
	}

	const { byDecision, byReason, byMode, recentMode } = result.right

	return c.json({
		windowDays: days,
		since: since.toISOString(),
		byDecision,
		byReason,
		byMode,
		mode: recentMode,
		// See MODE SOURCE note in the file header: compliance_mode is a python
		// env-only setting, not something api-ts can read live from the DB.
		modeSource: recentMode ? 'observed_from_events' : 'no_recent_events',
	})
})

// ─── GET /enterprise/orgs/:orgId/compliance/events ──────────────────────────
//
// Paginated, newest-first. Filters: decision, chain, direction, from/to (ISO
// date bounds on createdAt). Pagination is offset/limit (default 50 / max
// 200), matching enterpriseTransactions.ts / enterpriseAudit.ts.
//
// ?format=csv returns the same filtered set as text/csv with a
// Content-Disposition attachment header, capped at CSV_MAX_ROWS.
enterpriseComplianceRoutes.get('/orgs/:orgId/compliance/events', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Not an admin of this organization' }, 403)
	const orgId = membership.orgId

	const format = (c.req.query('format') ?? 'json').trim().toLowerCase()
	if (format !== 'json' && format !== 'csv') {
		return c.json({ error: `Invalid format: ${format}`, supported: ['json', 'csv'] }, 400)
	}

	const decision = c.req.query('decision')?.trim().toLowerCase()
	const chain = c.req.query('chain')?.trim().toLowerCase()
	const direction = c.req.query('direction')?.trim().toLowerCase()
	const fromParam = c.req.query('from')
	const toParam = c.req.query('to')

	const from = parseDateParam(fromParam)
	if (fromParam && !from) return c.json({ error: `Invalid from date: ${fromParam}` }, 400)
	const to = parseDateParam(toParam)
	if (toParam && !to) return c.json({ error: `Invalid to date: ${toParam}` }, 400)

	const isCsv = format === 'csv'
	const limit = isCsv ? CSV_MAX_ROWS : parseIntParam(c.req.query('limit'), 50, 200)
	const offset = parseIntParam(c.req.query('offset'), 0, 1_000_000)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const scope = yield* Effect.tryPromise({
				try: () => orgScopeCondition(db, orgId),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!scope) return { rows: [] as (typeof screeningEvents.$inferSelect)[], total: 0 }

			const conditions: SQL[] = [scope]
			if (decision) conditions.push(eq(screeningEvents.decision, decision))
			if (chain) conditions.push(sql`lower(${screeningEvents.chain}) = ${chain}`)
			if (direction) conditions.push(eq(screeningEvents.direction, direction))
			if (from) conditions.push(gte(screeningEvents.createdAt, from))
			if (to) conditions.push(lte(screeningEvents.createdAt, to))

			const where = and(...conditions)

			const [rows, totalRows] = yield* Effect.all([
				Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(screeningEvents)
							.where(where)
							.orderBy(desc(screeningEvents.createdAt))
							.limit(limit)
							.offset(offset),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				Effect.tryPromise({
					try: () =>
						db.select({ total: sql<number>`cast(count(*) as int)` }).from(screeningEvents).where(where),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
			])

			return { rows, total: Number(totalRows[0]?.total ?? 0) }
		}),
	)

	if (Either.isLeft(result)) {
		const { status: httpStatus, body } = mapErrorToResponse(result.left)
		return c.json(body, httpStatus as 200)
	}

	const { rows, total } = result.right

	const shaped = rows.map((row) => ({
		id: row.id,
		timestamp: row.createdAt,
		userId: row.userId,
		orgId: row.orgId,
		chain: row.chain,
		direction: row.direction,
		address: row.address,
		decision: row.decision,
		reason: row.reason,
		mode: row.mode,
		txContext: row.txContext,
	}))

	if (isCsv) {
		const header = [
			'id',
			'timestamp',
			'userId',
			'orgId',
			'chain',
			'direction',
			'address',
			'decision',
			'reason',
			'mode',
			'txContext',
		]
		const lines = [header.join(',')]
		for (const r of shaped) {
			lines.push(
				header
					.map((key) => {
						const value = (r as Record<string, unknown>)[key]
						const flat =
							value !== null && typeof value === 'object' && !(value instanceof Date)
								? JSON.stringify(value)
								: value
						return csvEscape(flat instanceof Date ? flat.toISOString() : flat)
					})
					.join(','),
			)
		}
		c.header('Content-Type', 'text/csv; charset=utf-8')
		c.header('Content-Disposition', `attachment; filename="org-${orgId}-compliance-events.csv"`)
		return c.body(lines.join('\n') + '\n')
	}

	return c.json({
		events: shaped,
		total,
		limit,
		offset,
	})
})
