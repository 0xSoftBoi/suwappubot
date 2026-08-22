import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import {
	type DrizzleService,
	type NewSwapTransaction,
	requireDb,
	type SwapTransaction,
	swapTransactions,
} from '../db'
import { DatabaseError } from '../errors'

export type SwapExecutionClaim =
	| { kind: 'created'; record: SwapTransaction }
	| { kind: 'replay'; record: SwapTransaction }
	| { kind: 'conflict'; record: SwapTransaction; differingFields: string[] }

const EXECUTION_INTENT_FIELDS = [
	'userId',
	'fromChain',
	'toChain',
	'fromToken',
	'toToken',
	'fromAmount',
	'toAmount',
	'routeProvider',
	'routeData',
	'slippage',
] as const satisfies ReadonlyArray<keyof NewSwapTransaction>

/**
 * Compare the durable economic/execution identity represented by a swap row.
 * Cost/telemetry fields are deliberately excluded; routeData is included so
 * reusing one key for a different quote/route is a conflict even when the
 * token amounts happen to match.
 */
export function differingSwapExecutionFields(
	existing: SwapTransaction,
	requested: NewSwapTransaction,
): string[] {
	const differing: string[] = []
	for (const field of EXECUTION_INTENT_FIELDS) {
		const left = existing[field as keyof SwapTransaction]
		const right = requested[field]
		if ((left ?? null) !== (right ?? null)) differing.push(field)
	}
	return differing
}

/**
 * Atomically claim a durable swap operation under the existing unique
 * swap_transactions.idempotency_key index.
 *
 * Unlike the legacy SELECT-then-INSERT path, concurrent callers race on the
 * database uniqueness constraint: exactly one insert can win. Losers load the
 * already-claimed row and MUST NOT proceed to signing/broadcast merely because
 * their HTTP request is a retry.
 */
export function claimSwapExecution(
	swap: NewSwapTransaction,
): Effect.Effect<SwapExecutionClaim, DatabaseError, DrizzleService> {
	return Effect.gen(function* () {
		const idempotencyKey = swap.idempotencyKey?.trim()
		if (!idempotencyKey) {
			return yield* Effect.fail(
				new DatabaseError({
					message: 'claimSwapExecution requires a durable idempotency key before money can move',
				}),
			)
		}

		const db = yield* requireDb.pipe(
			Effect.mapError((e) => new DatabaseError({ message: e.message })),
		)

		const inserted = yield* Effect.tryPromise({
			try: () =>
				db
					.insert(swapTransactions)
					.values({ ...swap, idempotencyKey })
					.onConflictDoNothing()
					.returning(),
			catch: (e) =>
				new DatabaseError({ message: `Failed to claim swap execution: ${e}`, cause: e }),
		})

		if (inserted[0]) return { kind: 'created' as const, record: inserted[0] }

		const existingRows = yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(swapTransactions)
					.where(eq(swapTransactions.idempotencyKey, idempotencyKey))
					.limit(1),
			catch: (e) =>
				new DatabaseError({ message: `Failed to load claimed swap execution: ${e}`, cause: e }),
		})
		const existing = existingRows[0]
		if (!existing) {
			return yield* Effect.fail(
				new DatabaseError({
					message:
						'Idempotency conflict occurred but the claimed swap row could not be loaded; fail closed before signing',
				}),
			)
		}

		const differingFields = differingSwapExecutionFields(existing, {
			...swap,
			idempotencyKey,
		})
		if (differingFields.length > 0) {
			return { kind: 'conflict' as const, record: existing, differingFields }
		}

		return { kind: 'replay' as const, record: existing }
	})
}
