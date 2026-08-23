import registry from '../../retry-contracts.json'

export type RetryClass =
	| 'natural-identity'
	| 'explicit-idempotency-key'
	| 'durable-operation-id'
	| 'unsafe-auto-retry'

export type RetryContract = {
	surface: string
	method: string
	path: string
	authority: string
	retryClass: RetryClass
	identitySource: string
	requiredIdentity: boolean
	sameRequest: string
	conflictingReuse: string
	concurrent: string
	unknownOutcome: string
	reconciliation: string
	source: string
	blocker: boolean
}

type RetryRegistry = {
	policy: string
	scope: string
	retryClasses: Record<RetryClass, string>
	operations: Record<string, RetryContract>
	excludedBoundaries: Record<string, string>
}

export const RETRY_CONTRACTS = registry as RetryRegistry

export function retryContractSummary() {
	const operations = Object.entries(RETRY_CONTRACTS.operations)
	const blockers = operations
		.filter(([, contract]) => contract.blocker)
		.map(([id, contract]) => ({ id, method: contract.method, path: contract.path, retryClass: contract.retryClass }))
	const byClass = operations.reduce<Record<string, number>>((counts, [, contract]) => {
		counts[contract.retryClass] = (counts[contract.retryClass] ?? 0) + 1
		return counts
	}, {})

	return {
		parity_blocked: blockers.length > 0,
		operation_count: operations.length,
		blocker_count: blockers.length,
		by_retry_class: byClass,
		blockers,
	}
}
