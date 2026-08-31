/**
 * GET /enterprise/orgs/:orgId/transactions — org-wide transaction monitoring.
 *
 * Split into its own file rather than appended to enterprise.ts, which was
 * already 1000+ lines before this endpoint; shares `resolveUserId` /
 * `resolveMembership` from enterprise.ts (exported there) and is mounted
 * under the same `/enterprise` prefix in app.ts (Hono supports multiple
 * `app.route()` calls at one prefix — see routes/index.ts).
 *
 * DATA-SOURCE DECISION: rows come from `swapTransactions`
 * (db/schema/swaps.ts) — the per-user, per-swap ledger with chain/token
 * pair, USD amounts, status, and settlement tx hashes already in one row.
 * The `execution*` tables (db/schema/execution.ts) model a multi-step
 * intent → candidate-plan → parent-order → child-placement → fill →
 * settlement state machine for the newer execution engine; there is no
 * single row there with a ready chain/pair/USD/status/txHash shape, and
 * joining five tables per row for a monitoring list is out of scope here.
 * `swapTransactions` is also what `/webapp/me/portfolio`-adjacent surfaces
 * and the treasury endpoints above already treat as the settled-trade
 * ledger, so this stays consistent with the rest of the file.
 */
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { requireDb, organizationMembers, swapTransactions } from '../db'
import { mapErrorToResponse } from '../errors'
import { flexAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { resolveMembership } from './enterprise'

export const enterpriseTransactionsRoutes = new Hono()

enterpriseTransactionsRoutes.use('*', flexAuth())

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
	const s = String(value)
	if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
	return s
}

const CSV_MAX_ROWS = 5000

// ─── GET /enterprise/orgs/:orgId/transactions ───────────────────────────────
//
// Any org member role (owner/admin/member/viewer) may read — this is a
// monitoring surface, not a mutation, so it follows the same read-role gate
// as GET .../members, .../api-keys, .../usage, and .../treasury above.
//
// Filters: chain (matches either leg — fromChain or toChain), status,
// userId (member filter — implicitly scoped to org members via the
// memberIds IN-list regardless), from/to (ISO date bounds on createdAt),
// minUsd (floor on the larger of the two USD legs). Pagination is
// offset/limit, matching the pattern already used in routes/autopilot.ts
// (limit default 50 / max 200) — this route file has no cursor precedent to
// match, and offset is sufficient for a filtered admin table with a page
// count in the low thousands at most.
//
// ?format=csv returns the same filtered set as text/csv with a
// Content-Disposition attachment header, capped at CSV_MAX_ROWS regardless
// of the requested limit (a dashboard "export all" should not be able to
// stream an unbounded table).
enterpriseTransactionsRoutes.get('/orgs/:orgId/transactions', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), [
		'owner',
		'admin',
		'member',
		'viewer',
	])
	if (!membership) return c.json({ error: 'Not a member of this organization' }, 403)
	const orgId = membership.orgId

	const format = (c.req.query('format') ?? 'json').trim().toLowerCase()
	if (format !== 'json' && format !== 'csv') {
		return c.json({ error: `Invalid format: ${format}`, supported: ['json', 'csv'] }, 400)
	}

	const chain = c.req.query('chain')?.trim().toLowerCase()
	const status = c.req.query('status')?.trim().toLowerCase()
	const userIdParam = c.req.query('userId')
	const fromParam = c.req.query('from')
	const toParam = c.req.query('to')
	const minUsdParam = c.req.query('minUsd')

	let filterUserId: number | undefined
	if (userIdParam !== undefined) {
		filterUserId = parseInt(userIdParam, 10)
		if (!Number.isFinite(filterUserId)) return c.json({ error: `Invalid userId: ${userIdParam}` }, 400)
	}

	const from = parseDateParam(fromParam)
	if (fromParam && !from) return c.json({ error: `Invalid from date: ${fromParam}` }, 400)
	const to = parseDateParam(toParam)
	if (toParam && !to) return c.json({ error: `Invalid to date: ${toParam}` }, 400)

	let minUsd: number | undefined
	if (minUsdParam !== undefined) {
		minUsd = Number(minUsdParam)
		if (!Number.isFinite(minUsd)) return c.json({ error: `Invalid minUsd: ${minUsdParam}` }, 400)
	}

	const isCsv = format === 'csv'
	const limit = isCsv
		? CSV_MAX_ROWS
		: parseIntParam(c.req.query('limit'), 50, 200)
	const offset = parseIntParam(c.req.query('offset'), 0, 1_000_000)

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const memberRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ userId: organizationMembers.userId })
						.from(organizationMembers)
						.where(eq(organizationMembers.organizationId, orgId)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			const memberIds = memberRows.map((m) => m.userId)
			if (memberIds.length === 0) {
				return { rows: [] as (typeof swapTransactions.$inferSelect)[], total: 0 }
			}

			const conditions: SQL[] = [inArray(swapTransactions.userId, memberIds)]
			if (chain) {
				conditions.push(
					sql`(lower(${swapTransactions.fromChain}) = ${chain} or lower(${swapTransactions.toChain}) = ${chain})`,
				)
			}
			if (status) conditions.push(eq(swapTransactions.status, status))
			if (filterUserId !== undefined) conditions.push(eq(swapTransactions.userId, filterUserId))
			if (from) conditions.push(gte(swapTransactions.createdAt, from))
			if (to) conditions.push(lte(swapTransactions.createdAt, to))
			if (minUsd !== undefined) {
				conditions.push(
					sql`greatest(coalesce(${swapTransactions.fromAmountUsd}, 0), coalesce(${swapTransactions.realizedToAmountUsd}, ${swapTransactions.toAmountUsd}, 0)) >= ${minUsd}`,
				)
			}

			const where = and(...conditions)

			const [rows, [{ total }]] = yield* Effect.all([
				Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(swapTransactions)
							.where(where)
							.orderBy(desc(swapTransactions.createdAt))
							.limit(limit)
							.offset(offset),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				Effect.tryPromise({
					try: () =>
						db
							.select({ total: sql<number>`cast(count(*) as int)` })
							.from(swapTransactions)
							.where(where),
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

	const shaped = rows.map((tx) => ({
		id: tx.id,
		timestamp: tx.createdAt,
		userId: tx.userId,
		fromChain: tx.fromChain,
		toChain: tx.toChain,
		fromToken: tx.fromToken,
		toToken: tx.toToken,
		fromAmount: tx.fromAmount,
		toAmount: tx.toAmount,
		realizedToAmount: tx.realizedToAmount,
		fromAmountUsd: tx.fromAmountUsd,
		toAmountUsd: tx.toAmountUsd,
		realizedToAmountUsd: tx.realizedToAmountUsd,
		status: tx.status,
		txHash: tx.txHash,
		bridgeTxHash: tx.bridgeTxHash,
		destinationTxHash: tx.destinationTxHash,
	}))

	if (isCsv) {
		const header = [
			'id',
			'timestamp',
			'userId',
			'fromChain',
			'toChain',
			'fromToken',
			'toToken',
			'fromAmount',
			'toAmount',
			'realizedToAmount',
			'fromAmountUsd',
			'toAmountUsd',
			'realizedToAmountUsd',
			'status',
			'txHash',
			'bridgeTxHash',
			'destinationTxHash',
		]
		const lines = [header.join(',')]
		for (const r of shaped) {
			lines.push(
				header
					.map((key) => {
						const value = (r as Record<string, unknown>)[key]
						return csvEscape(
							value instanceof Date ? value.toISOString() : value,
						)
					})
					.join(','),
			)
		}
		c.header('Content-Type', 'text/csv; charset=utf-8')
		c.header(
			'Content-Disposition',
			`attachment; filename="org-${orgId}-transactions.csv"`,
		)
		return c.body(lines.join('\n') + '\n')
	}

	return c.json({
		transactions: shaped,
		total,
		limit,
		offset,
	})
})
