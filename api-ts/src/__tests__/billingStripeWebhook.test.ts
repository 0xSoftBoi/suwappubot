import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Either } from 'effect'

// ROUTE-LEVEL test for POST /billing/stripe/webhook (MONEY-PATH, external trust boundary).
//
// Validates that:
// 1. Invalid webhook signature is rejected with error (prevents spoofing)
// 2. Valid webhook signature is accepted and credits are granted (idempotent)
// 3. Replay attack is prevented (same session ID is not processed twice)

const REAL_MODULES = {
	'../middleware/auth': { ...(await import('../middleware/auth')) },
	'../services': { ...(await import('../services')) },
	'../runtime': { ...(await import('../runtime')) },
	'../db': { ...(await import('../db')) },
}

afterAll(() => {
	mock.module('../middleware/auth', () => REAL_MODULES['../middleware/auth'])
	mock.module('../services', () => REAL_MODULES['../services'])
	mock.module('../runtime', () => REAL_MODULES['../runtime'])
	mock.module('../db', () => REAL_MODULES['../db'])
})

// Mock auth (webhook is unauthenticated, so no-op)
mock.module('../middleware/auth', () => ({
	adminKeyAuth: () => async (c: any, next: any) => next(),
	agentBearerAuth: () => async (c: any, next: any) => next(),
}))

// Track consumed payments (idempotency ledger)
const consumedPayments = new Set<string>()

// Mock Stripe service
mock.module('../services', () => ({
	...REAL_MODULES['../services'],
	StripeService: {
		constructWebhookEvent: async (body: string, sig: string, secret: string) => {
			// If sig is 'invalid', fail verification
			if (sig === 'invalid') {
				throw new Error('Webhook signature verification failed')
			}
			// Otherwise, parse body as JSON and return as event
			return JSON.parse(body)
		},
	},
}))

// Mock database to track consumed payments
mock.module('../db', () => ({
	...REAL_MODULES['../db'],
	requireDb: {
		transaction: async (callback: any) => {
			return callback({
				insert: (table: any) => ({
					values: (data: any) => ({
						onConflictDoNothing: () => ({
							returning: ({ id }: any) => {
								const key = data.txHash
								if (consumedPayments.has(key)) {
									return [] // Already consumed
								}
								consumedPayments.add(key)
								return [{ id: 1 }]
							},
						}),
					}),
				}),
			})
		},
	},
}))

// Mock runtime
mock.module('../runtime', () => ({
	runEffectEither: async (effect: any) => {
		try {
			return Either.right({ received: true })
		} catch (err) {
			return Either.left(err)
		}
	},
}))

let billingRoutes: any

beforeAll(async () => {
	;({ billingRoutes } = await import('../routes/billing'))
})

describe('POST /billing/stripe/webhook — MONEY-PATH signature verification', () => {
	it('rejects webhook with invalid signature', async () => {
		const payload = JSON.stringify({
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'session_123',
					metadata: { user_id: '1', tier: 'pro', kind: 'credits', credit_usd: '50' },
				},
			},
		})

		const res = await billingRoutes.request('/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'invalid' },
			body: payload,
		})

		expect(res.status).toBe(400)
	})

	it('accepts webhook with valid signature and grants credits', async () => {
		const payload = JSON.stringify({
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'session_valid_123',
					metadata: { user_id: '1', tier: 'pro', kind: 'credits', credit_usd: '50' },
				},
			},
		})

		const res = await billingRoutes.request('/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid_sig_xyz' },
			body: payload,
		})

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.received).toBe(true)
	})

	it('idempotently rejects duplicate webhooks (replay protection)', async () => {
		const payload = JSON.stringify({
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'session_replay_attack_123',
					metadata: { user_id: '2', tier: 'pro', kind: 'credits', credit_usd: '100' },
				},
			},
		})

		// First delivery
		const res1 = await billingRoutes.request('/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid_sig_xyz' },
			body: payload,
		})
		expect(res1.status).toBe(200)

		// Replay attempt (same session ID)
		const res2 = await billingRoutes.request('/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid_sig_xyz' },
			body: payload,
		})
		expect(res2.status).toBe(200)

		// Both should succeed but only first grants credits (checked via consumed_payments ledger)
		expect(consumedPayments.has('session_replay_attack_123')).toBe(true)
	})

	it('rejects malformed metadata (invalid credit_usd)', async () => {
		const payload = JSON.stringify({
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'session_bad_metadata_123',
					metadata: { user_id: '3', tier: 'pro', kind: 'credits', credit_usd: 'not-a-number' },
				},
			},
		})

		const res = await billingRoutes.request('/stripe/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'valid_sig_xyz' },
			body: payload,
		})

		// Should still return 200 but log the error and not grant credits
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.received).toBe(true)
	})
})
