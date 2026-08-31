/**
 * GET /enterprise/orgs/:orgId/reports/:period — accounting-friendly periodic
 * statement (Coinbase Prime journal-entry pattern).
 *
 * Split into its own file for the same reason as enterpriseTransactions.ts —
 * follows its conventions: shares `resolveMembership` from ./enterprise, is
 * mounted under the same `/enterprise` prefix via routes/index.ts (Hono
 * supports multiple `app.route()` calls at one prefix), and reuses the
 * swapTransactions member-scoping / csvEscape helper pattern verbatim.
 *
 * DATA-SOURCE DECISION (fees): `swapTransactions` (db/schema/swaps.ts) carries
 * `feeCostUsd` / `gasFee` / `bridgeFee` directly on the same row as the
 * settled trade — no join is needed against `db/schema/fees.ts`
 * (`feeTransactions`, keyed by a separate `swapId` int with no FK
 * constraint, and `feeConfig`/`feeSummaries`, which are global config/rollup
 * tables with no per-member or per-org linkage at all). Using the columns
 * already on `swapTransactions` keeps the journal and the fee total counting
 * the exact same row set, which a join against `feeTransactions` could not
 * guarantee (it is a parallel, not-strictly-1:1 ledger). `totalFeesUsd` is
 * therefore `sum(feeCostUsd)` over the period's completed swaps.
 */
import { and, asc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { requireDb, organizations, organizationMembers, swapTransactions } from '../db'
import { mapErrorToResponse } from '../errors'
import { flexAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { auditLog } from '../services/audit'
import { resolveMembership } from './enterprise'

export const enterpriseReportsRoutes = new Hono()

enterpriseReportsRoutes.use('*', flexAuth())

function csvEscape(value: unknown): string {
	if (value === null || value === undefined) return ''
	let s = String(value)
	// Neutralize spreadsheet formula injection (=, +, -, @ leading a cell).
	if (/^[=+\-@]/.test(s)) s = `'${s}`
	if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
	return s
}

const CSV_MAX_ROWS = 10_000

const PERIOD_RE = /^(\d{4})-(\d{2})$/

/** Parse a strict `YYYY-MM` period into its UTC month bounds. Returns null on
 *  any malformed input (non-2-digit month, out-of-range month, etc). */
function parsePeriod(raw: string): { year: number; month: number; start: Date; end: Date } | null {
	const m = PERIOD_RE.exec(raw)
	if (!m) return null
	const year = Number(m[1])
	const month = Number(m[2])
	if (month < 1 || month > 12) return null
	const start = new Date(Date.UTC(year, month - 1, 1))
	const end = new Date(Date.UTC(year, month, 1))
	return { year, month, start, end }
}

// ─── GET /enterprise/orgs/:orgId/reports/:period ────────────────────────────
//
// Admin+ only (owner/admin) — this exports member trade/journal data, a
// stricter gate than the member/viewer read-role used by
// .../transactions and .../treasury above.
//
// `period` is strictly `YYYY-MM`; malformed input or a period in the future
// (relative to the current UTC month) is rejected with 400 rather than
// silently returning an empty or partial statement.
//
// ?format=csv returns the journal rows only (no summary block — accounting
// tools import plain tables best) as text/csv, capped at CSV_MAX_ROWS.
enterpriseReportsRoutes.get('/orgs/:orgId/reports/:period', async (c) => {
	const membership = await resolveMembership(c, c.req.param('orgId'), ['owner', 'admin'])
	if (!membership) return c.json({ error: 'Owner or admin role required' }, 403)
	const orgId = membership.orgId

	const periodParam = c.req.param('period')
	const parsed = parsePeriod(periodParam)
	if (!parsed) {
		return c.json({ error: `Invalid period: ${periodParam}. Expected format YYYY-MM.` }, 400)
	}
	const { start, end } = parsed

	const now = new Date()
	const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
	if (start.getTime() > currentMonthStart.getTime()) {
		return c.json({ error: `Period ${periodParam} is in the future` }, 400)
	}

	const format = (c.req.query('format') ?? 'json').trim().toLowerCase()
	if (format !== 'json' && format !== 'csv') {
		return c.json({ error: `Invalid format: ${format}`, supported: ['json', 'csv'] }, 400)
	}
	const isCsv = format === 'csv'

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb

			const [org] = yield* Effect.tryPromise({
				try: () => db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!org) return yield* Effect.fail(new Error('Organization not found'))

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
				return { org, journalRows: [] as (typeof swapTransactions.$inferSelect)[], statusCounts: {} as Record<string, number> }
			}

			const periodCond: SQL = and(
				inArray(swapTransactions.userId, memberIds),
				gte(swapTransactions.createdAt, start),
				lt(swapTransactions.createdAt, end),
			)!

			const [journalRows, statusCountRows] = yield* Effect.all([
				// Journal: completed swaps only, ordered by date (statement order).
				Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(swapTransactions)
							.where(and(periodCond, eq(swapTransactions.status, 'completed')))
							.orderBy(asc(swapTransactions.createdAt))
							.limit(CSV_MAX_ROWS),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
				// Status breakdown across ALL statuses in the period (for the summary,
				// not just completed) — same period window, no status filter.
				Effect.tryPromise({
					try: () =>
						db
							.select({
								status: swapTransactions.status,
								count: sql<number>`cast(count(*) as int)`,
							})
							.from(swapTransactions)
							.where(periodCond)
							.groupBy(swapTransactions.status),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),
			])

			const statusCounts: Record<string, number> = {}
			for (const row of statusCountRows) {
				statusCounts[row.status ?? 'unknown'] = Number(row.count)
			}

			return { org, journalRows, statusCounts }
		}),
	)

	if (Either.isLeft(result)) {
		const err = result.left as Error
		if (err.message === 'Organization not found') return c.json({ error: err.message }, 404)
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	const { org, journalRows, statusCounts } = result.right

	const journal = journalRows.map((tx) => {
		const creditAmount = tx.realizedToAmount ?? tx.toAmount
		const creditUsd = tx.realizedToAmountUsd ?? tx.toAmountUsd
		const valueUsd = creditUsd ?? tx.fromAmountUsd ?? null
		return {
			date: tx.createdAt,
			txId: tx.id,
			userId: tx.userId,
			description: `Swap ${tx.fromAmount} ${tx.fromToken} (${tx.fromChain}) -> ${creditAmount ?? '?'} ${tx.toToken} (${tx.toChain})`,
			debitAsset: tx.fromToken,
			debitAmount: tx.fromAmount,
			creditAsset: tx.toToken,
			creditAmount,
			valueUsd,
			feeUsd: tx.feeCostUsd,
			status: tx.status,
			txHash: tx.txHash,
		}
	})

	const totalVolumeUsd = journalRows.reduce(
		(sum, tx) => sum + (tx.realizedToAmountUsd ?? tx.toAmountUsd ?? tx.fromAmountUsd ?? 0),
		0,
	)
	const totalFeesUsd = journalRows.reduce((sum, tx) => {
		const fee = tx.feeCostUsd != null ? Number(tx.feeCostUsd) : 0
		return sum + (Number.isFinite(fee) ? fee : 0)
	}, 0)
	const uniqueMembersActive = new Set(journalRows.map((tx) => tx.userId)).size
	const period = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`

	if (isCsv) {
		const header = [
			'date',
			'txId',
			'userId',
			'description',
			'debitAsset',
			'debitAmount',
			'creditAsset',
			'creditAmount',
			'valueUsd',
			'status',
			'txHash',
		]
		const lines = [header.join(',')]
		for (const row of journal) {
			lines.push(
				header
					.map((key) => {
						const value = (row as Record<string, unknown>)[key]
						return csvEscape(value instanceof Date ? value.toISOString() : value)
					})
					.join(','),
			)
		}

		await runEffectEither(
			auditLog({
				userId: membership.userId,
				orgId,
				eventType: 'enterprise.report.generated',
				details: { period, rowCount: journal.length, format: 'csv' },
			}),
		)

		c.header('Content-Type', 'text/csv; charset=utf-8')
		c.header('Content-Disposition', `attachment; filename="org-${orgId}-statement-${period}.csv"`)
		return c.body(lines.join('\n') + '\n')
	}

	await runEffectEither(
		auditLog({
			userId: membership.userId,
			orgId,
			eventType: 'enterprise.report.generated',
			details: { period, rowCount: journal.length, format: 'json' },
		}),
	)

	return c.json({
		summary: {
			period,
			org: { id: org.id, name: org.name, slug: org.slug },
			txCountsByStatus: statusCounts,
			totalVolumeUsd,
			totalFeesUsd,
			uniqueMembersActive,
		},
		journal,
		generatedAt: new Date().toISOString(),
		note: 'USD values (valueUsd, totalVolumeUsd, totalFeesUsd) are trade-time snapshots, not current mark-to-market.',
	})
})
