import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { RETRY_CONTRACTS, retryContractSummary } from '../lib/retryContracts'
import { healthRoutes } from '../routes/health'

function app() {
	const instance = new Hono()
	instance.route('/', healthRoutes)
	return instance
}

describe('money-write retry contracts', () => {
	it('publishes audited operations and parity blockers', async () => {
		const res = await app().request('/v1/retry-contracts')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, any>
		expect(body.operations['agent.swap.execute'].retryClass).toBe('explicit-idempotency-key')
		expect(body.operations['agent.billing.topup'].retryClass).toBe('natural-identity')
		expect(body.operations['agent.prediction.place-order'].retryClass).toBe('unsafe-auto-retry')
		expect(body.operations['agent.prediction.place-order'].blocker).toBe(true)
		expect(body.operations['terminal.swap.execute'].retryClass).toBe('durable-operation-id')
		expect(body.summary.parity_blocked).toBe(true)
		expect(body.summary.blocker_count).toBeGreaterThan(0)
	})

	it('requires unsafe automatic retries to remain explicit blockers', () => {
		for (const contract of Object.values(RETRY_CONTRACTS.operations)) {
			if (contract.retryClass === 'unsafe-auto-retry') expect(contract.blocker).toBe(true)
			expect(contract.unknownOutcome.length).toBeGreaterThan(0)
			expect(contract.reconciliation.length).toBeGreaterThan(0)
		}
	})

	it('keeps summary counts derived from the registry', () => {
		const summary = retryContractSummary()
		expect(summary.operation_count).toBe(Object.keys(RETRY_CONTRACTS.operations).length)
		expect(summary.blocker_count).toBe(summary.blockers.length)
		expect(summary.parity_blocked).toBe(summary.blocker_count > 0)
	})
})
