/**
 * GET /enterprise/orgs/:orgId/audit — hash-chained audit log surface.
 * GET /enterprise/orgs/:orgId/audit/verify — recompute + verify the hash chain.
 *
 * Split into its own file for the same reason as enterpriseTransactions.ts
 * (enterprise.ts is already 1000+ lines); shares `resolveMembership` from
 * enterprise.ts and is mounted under the same `/enterprise` prefix in
 * app.ts (Hono supports multiple `app.route()` calls at one prefix — see
 * routes/index.ts).
 *
 * DATA-SOURCE: `auditLogs` (db/schema/security.ts). Every row is chained via
 * `entryHash = sha256(canonical JSON of {userId, orgId, agentId, eventType,
 * details, ts, prevHash})`, keyed per-org (a shared 'global' chain covers
 * org-less rows) — see services/audit.ts (`auditLog`, `computeEntryHash`,
 * `verifyAuditChain`), which is the ONLY writer of this table. The verify
 * endpoint below reuses `verifyAuditChain` directly rather than
 * re-implementing the hash so the two can never drift.
 *
 * Roles: both endpoints here are admin+ only (owner, admin) — unlike the
 * transactions/treasury reads (open to member/viewer), the audit log can
 * contain other members' actions and IPs, so it is restricted to org admins.
 */
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { requireDb, auditLogs } from '../db'
import { mapErrorToResponse } from '../errors'
import { flexAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { verifyAuditChain } from '../services/audit'
import { resolveMembership } from './enterprise'

export const enterpriseAuditRoutes = new Hono()

enterpriseAuditRoutes.use('*', flexAuth())

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

// ─── GET /enterprise/orgs/:orgId/audit ──────────────────────────────────────
//
// Paginated, newest-first (ordered by `id`, which is chain-monotonic —
// createdAt is a tz-less timestamp column and not safe to sort by, see the
// tsRaw comment in services/audit.ts). Filters: eventType (exact match),
// userId (actor), from/to (ISO date bounds on createdAt). Pagination is
// offset/limit (default 50 / max 200), matching enterpriseTransactions.ts.
//
// ?format=csv returns the same filtered set as text/csv with a
// Content-Disposition attachment header, capped at CSV_MAX_ROWS.
enterpriseAuditRoutes.get('/orgs/:orgId/audit', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Not an admin of this organization' }, 403)
	const orgId = membership.orgId

	const format = (c.req.query('format') ?? 'json').trim().toLowerCase()
	if (format !== 'json' && format !== 'csv') {
		return c.json({ error: `Invalid format: ${format}`, supported: ['json', 'csv'] }, 400)
	}

	const eventType = c.req.query('eventType')?.trim()
	const userIdParam = c.req.query('userId')
	const fromParam = c.req.query('from')
	const toParam = c.req.query('to')

	let filterUserId: number | undefined
	if (userIdParam !== undefined) {
		filterUserId = parseInt(userIdParam, 10)
		if (!Number.isFinite(filterUserId)) return c.json({ error: `Invalid userId: ${userIdParam}` }, 400)
	}

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

			const conditions: SQL[] = [eq(auditLogs.orgId, orgId)]
			if (eventType) conditions.push(eq(auditLogs.eventType, eventType))
			if (filterUserId !== undefined) conditions.push(eq(auditLogs.userId, filterUserId))
			if (from) conditions.push(gte(auditLogs.createdAt, from))
			if (to) conditions.push(lte(auditLogs.createdAt, to))

			const where = and(...conditions)

			const [rows, [{ total }]] = yield* Effect.all([
				Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(auditLogs)
							.where(where)
							.orderBy(desc(auditLogs.id))
							.limit(limit)
							.offset(offset),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				Effect.tryPromise({
					try: () =>
						db.select({ total: sql<number>`cast(count(*) as int)` }).from(auditLogs).where(where),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
			])

			return { rows, total: Number(total) }
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
		agentId: row.agentId,
		eventType: row.eventType,
		details: row.details,
		ipAddress: row.ipAddress,
		prevHash: row.prevHash,
		entryHash: row.entryHash,
	}))

	if (isCsv) {
		const header = [
			'id',
			'timestamp',
			'userId',
			'orgId',
			'agentId',
			'eventType',
			'details',
			'ipAddress',
			'prevHash',
			'entryHash',
		]
		const lines = [header.join(',')]
		for (const r of shaped) {
			lines.push(
				header
					.map((key) => {
						const value = (r as Record<string, unknown>)[key]
						return csvEscape(value instanceof Date ? value.toISOString() : value)
					})
					.join(','),
			)
		}
		c.header('Content-Type', 'text/csv; charset=utf-8')
		c.header('Content-Disposition', `attachment; filename="org-${orgId}-audit.csv"`)
		return c.body(lines.join('\n') + '\n')
	}

	return c.json({
		events: shaped,
		total,
		limit,
		offset,
	})
})

// ─── GET /enterprise/orgs/:orgId/audit/verify ───────────────────────────────
//
// Recomputes the hash chain over this org's `auditLogs` rows (chained
// per-org, per services/audit.ts `chainKeyOf`) and reports whether every
// row's stored `entryHash` matches `computeEntryHash` of its own fields
// chained to the previous row's `entryHash`. Delegates to
// `verifyAuditChain` (services/audit.ts) — the exact function the writer's
// module also uses for its own recompute logic — so this endpoint can never
// drift from how entries are actually hashed at insert time (same field
// order: userId, orgId, agentId, eventType, details, ts, prevHash; same
// sha256-of-canonical-JSON algorithm; same tsRaw-preferred timestamp source
// to avoid TZ round-trip drift on the tz-less `createdAt` column).
//
// `limit` bounds how many of the org's most recent rows are walked (default
// 1000, max 10000) — the chain can grow unbounded, and this is a live admin
// request, not a batch job. `checkedCount` reports how many rows were
// actually walked so a truncated verification is visible to the caller.
enterpriseAuditRoutes.get('/orgs/:orgId/audit/verify', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ADMIN_ROLES)
	if (!membership) return c.json({ error: 'Not an admin of this organization' }, 403)
	const orgId = membership.orgId

	const limit = parseIntParam(c.req.query('limit'), 1000, 10_000)

	const result = await runEffectEither(verifyAuditChain(orgId, limit))

	if (Either.isLeft(result)) {
		const { status: httpStatus, body } = mapErrorToResponse(result.left)
		return c.json(body, httpStatus as 200)
	}

	const { valid, checked, firstBreakId } = result.right

	return c.json({
		valid,
		checkedCount: checked,
		firstBrokenAt: firstBreakId ?? null,
	})
})
