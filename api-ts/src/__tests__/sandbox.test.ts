import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { healthRoutes } from '../routes/health'
import { SANDBOX_WEBHOOK_TEST_SECRET } from '../routes/sandbox'

function app() {
	const instance = new Hono()
	instance.route('/', healthRoutes)
	return instance
}

describe('deterministic contract sandbox', () => {
	it('advertises an explicit no-funds/no-provider boundary', async () => {
		const res = await app().request('/v1/sandbox')
		expect(res.status).toBe(200)
		expect(res.headers.get('X-Suwappu-Environment')).toBe('sandbox')
		const body = (await res.json()) as Record<string, any>
		expect(body.environment).toBe('sandbox')
		expect(body.real_funds).toBe(false)
		expect(body.provider_calls).toBe(false)
		expect(body.rpc_calls).toBe(false)
		expect(body.signing).toBe(false)
		expect(body.broadcast).toBe(false)
		expect(body.billing).toBe(false)
		expect(body.production_database).toBe(false)
		expect(body.persistence).toBe('ephemeral-in-memory')
	})

	it('replays the same idempotent request and rejects key reuse with different terms', async () => {
		const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'sandbox-idem-1' }
		const first = await app().request('/v1/sandbox/simulate', {
			method: 'POST',
			headers,
			body: JSON.stringify({ scenario: 'success', from_token: 'ETH', to_token: 'USDC', amount: '1', chain: 'base' }),
		})
		expect(first.status).toBe(200)
		const firstBody = (await first.json()) as Record<string, any>
		expect(firstBody.broadcast).toBe(false)
		expect(firstBody.tx_hash).toBeNull()

		const replay = await app().request('/v1/sandbox/simulate', {
			method: 'POST',
			headers,
			body: JSON.stringify({ scenario: 'success', from_token: 'ETH', to_token: 'USDC', amount: '1', chain: 'base' }),
		})
		expect(replay.status).toBe(200)
		expect(replay.headers.get('X-Idempotent-Replayed')).toBe('true')
		const replayBody = (await replay.json()) as Record<string, any>
		expect(replayBody.operation_id).toBe(firstBody.operation_id)
		expect(replayBody.idempotent_replay).toBe(true)

		const conflict = await app().request('/v1/sandbox/simulate', {
			method: 'POST',
			headers,
			body: JSON.stringify({ scenario: 'success', from_token: 'ETH', to_token: 'USDC', amount: '2', chain: 'base' }),
		})
		expect(conflict.status).toBe(409)
		const conflictBody = (await conflict.json()) as Record<string, any>
		expect(conflictBody.error_code).toBe('IDEMPOTENCY_CONFLICT')
		expect(conflictBody.broadcast).toBe(false)
	})

	it('forces protocol-relevant failures without calling a provider', async () => {
		const limited = await app().request('/v1/sandbox/simulate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ scenario: 'rate_limited' }),
		})
		expect(limited.status).toBe(429)
		expect(limited.headers.get('Retry-After')).toBe('2')
		const limitedBody = (await limited.json()) as Record<string, any>
		expect(limitedBody.error_code).toBe('RATE_LIMITED')
		expect(limitedBody.broadcast).toBe(false)

		const blocked = await app().request('/v1/sandbox/simulate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ scenario: 'policy_rejected' }),
		})
		expect(blocked.status).toBe(403)
		const blockedBody = (await blocked.json()) as Record<string, any>
		expect(blockedBody.error_code).toBe('POLICY_VIOLATION')
		expect(blockedBody.signed).toBe(false)
		expect(blockedBody.broadcast).toBe(false)
	})

	it('models an unknown outcome that must be reconciled before retry', async () => {
		const created = await app().request('/v1/sandbox/simulate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'sandbox-unknown-1' },
			body: JSON.stringify({ scenario: 'unknown_outcome', amount: '0.5' }),
		})
		expect(created.status).toBe(202)
		const createdBody = (await created.json()) as Record<string, any>
		expect(createdBody.outcome).toBe('unknown')
		expect(createdBody.reconcile_required).toBe(true)
		expect(createdBody.broadcast).toBe(false)

		const inspected = await app().request(`/v1/sandbox/operations/${createdBody.operation_id}`)
		expect(inspected.status).toBe(200)
		const inspectedBody = (await inspected.json()) as Record<string, any>
		expect(inspectedBody.outcome).toBe('unknown')

		const resolved = await app().request(`/v1/sandbox/operations/${createdBody.operation_id}/resolve`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ resolution: 'simulated_success' }),
		})
		expect(resolved.status).toBe(200)
		const resolvedBody = (await resolved.json()) as Record<string, any>
		expect(resolvedBody.outcome).toBe('simulated_success')
		expect(resolvedBody.reconcile_required).toBe(false)
	})

	it('emits a locally verifiable webhook fixture without network delivery', async () => {
		const timestamp = '2026-08-21T18:00:00.000Z'
		const res = await app().request('/v1/sandbox/webhook-fixture', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ event_type: 'swap.status.updated', operation_id: 'sbx_fixture', timestamp }),
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, any>
		expect(body.real_delivery).toBe(false)
		expect(body.test_secret).toBe(SANDBOX_WEBHOOK_TEST_SECRET)
		const expected = createHmac(
			'sha256',
			createHash('sha256').update(SANDBOX_WEBHOOK_TEST_SECRET).digest(),
		)
			.update(body.raw_body)
			.digest('hex')
		expect(body.headers['X-Suwappu-Signature']).toBe(expected)
	})

	it('advances only a virtual clock', async () => {
		const res = await app().request('/v1/sandbox/clock/advance', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ now: '2026-08-21T00:00:00.000Z', seconds: 3600 }),
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, any>
		expect(body.virtual_time).toBe('2026-08-21T01:00:00.000Z')
		expect(body.production_clock_changed).toBe(false)
	})

	it('has no production money-path imports or network calls in the sandbox module', () => {
		const source = readFileSync(new URL('../routes/sandbox.ts', import.meta.url), 'utf8')
		for (const forbidden of [
			"from '../services'",
			"from '../db'",
			'EnvService',
			'Turnkey',
			'SwapService',
			'Jupiter',
			'Li.Fi',
			'fetch(',
			'INTERNAL_API',
			'AGENT_METERING',
		]) {
			expect(source).not.toContain(forbidden)
		}
	})
})
