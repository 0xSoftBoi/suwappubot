import { eq } from 'drizzle-orm'
import type { DbClient, DbTransaction } from '../db/client'
import { executionIntents, executionParentOrders } from '../db/schema/execution'
import { ExecutionLifecycleError, ExecutionPreflightError } from './executionLifecycle'

type ExecutionDb = DbClient | DbTransaction

const ACTIVE_STATES = new Set([
	'authorized',
	'preflight_validated',
	'submitting',
	'submitted',
	'source_confirmed',
	'settlement_pending',
	'recovery_pending',
])

export interface PrincipalRiskLimits {
	maxOpenOrders: number
	maxSingleOrderNotionalUsd: number
	maxOpenNotionalUsd: number
}

export interface PrincipalExposureSnapshot {
	principalKey: string
	openOrders: number
	openNotionalUsd: number
	currentOrderNotionalUsd: number
}

function positiveFinite(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new ExecutionLifecycleError(`${name} must be finite and > 0`)
	}
	return value
}

function parseNotional(value: string | null, context: string): number {
	if (value === null || value.trim() === '') {
		throw new ExecutionPreflightError(`Missing requested notional for ${context}`)
	}
	const parsed = Number(value)
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new ExecutionPreflightError(`Invalid requested notional for ${context}`)
	}
	return parsed
}

/**
 * Aggregate exposure by principal across every active parent order, independent
 * of provider/venue/substrate. This is intentionally evaluated at the dispatch
 * boundary, not merely in route scoring, so venue fan-out cannot bypass a limit.
 * Missing or malformed notionals fail closed.
 */
export async function assertPrincipalRiskLimits(
	db: ExecutionDb,
	parentOrderId: string,
	limits: PrincipalRiskLimits,
): Promise<PrincipalExposureSnapshot> {
	if (!Number.isInteger(limits.maxOpenOrders) || limits.maxOpenOrders <= 0) {
		throw new ExecutionLifecycleError('maxOpenOrders must be a positive integer')
	}
	positiveFinite(limits.maxSingleOrderNotionalUsd, 'maxSingleOrderNotionalUsd')
	positiveFinite(limits.maxOpenNotionalUsd, 'maxOpenNotionalUsd')

	const currentRows = await db
		.select({
			parentId: executionParentOrders.id,
			principalKey: executionIntents.principalKey,
			requestedNotional: executionIntents.requestedNotional,
		})
		.from(executionParentOrders)
		.innerJoin(executionIntents, eq(executionParentOrders.intentId, executionIntents.id))
		.where(eq(executionParentOrders.id, parentOrderId))
		.limit(1)
	const current = currentRows[0]
	if (!current) throw new ExecutionPreflightError('Parent order/principal not found for risk gate')
	const currentOrderNotionalUsd = parseNotional(current.requestedNotional, `parent ${parentOrderId}`)

	const rows = await db
		.select({
			parentId: executionParentOrders.id,
			state: executionParentOrders.state,
			requestedNotional: executionIntents.requestedNotional,
		})
		.from(executionParentOrders)
		.innerJoin(executionIntents, eq(executionParentOrders.intentId, executionIntents.id))
		.where(eq(executionIntents.principalKey, current.principalKey))

	let openOrders = 0
	let openNotionalUsd = 0
	for (const row of rows) {
		if (!ACTIVE_STATES.has(row.state)) continue
		openOrders += 1
		openNotionalUsd += parseNotional(row.requestedNotional, `active parent ${row.parentId}`)
	}

	if (currentOrderNotionalUsd > limits.maxSingleOrderNotionalUsd) {
		throw new ExecutionPreflightError(
			`Single-order notional ${currentOrderNotionalUsd} exceeds limit ${limits.maxSingleOrderNotionalUsd}`,
		)
	}
	if (openOrders > limits.maxOpenOrders) {
		throw new ExecutionPreflightError(
			`Open-order count ${openOrders} exceeds principal limit ${limits.maxOpenOrders}`,
		)
	}
	if (openNotionalUsd > limits.maxOpenNotionalUsd) {
		throw new ExecutionPreflightError(
			`Open notional ${openNotionalUsd} exceeds principal limit ${limits.maxOpenNotionalUsd}`,
		)
	}

	return {
		principalKey: current.principalKey,
		openOrders,
		openNotionalUsd,
		currentOrderNotionalUsd,
	}
}
