import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { EnvService } from '../config/EnvService'
import { DrizzleService } from '../db'
import { StripeService } from '../services/StripeService'

// ROUTE-LEVEL test for POST /billing/stripe/webhook (MONEY-PATH, external trust boundary).
// The prior test returned a canned success from runEffectEither(), which meant
// signature verification and the idempotency transaction were never executed.

const REAL_RUNTIME = { ...(await import('../runtime')) }

const consumedStripeSessions = new Set<string>()
let creditGrantCount = 0

const fakeTx: any = {
	execute: async () => undefined,
	select: () => ({
		from: () => ({
			where: () => ({
				orderBy: () => ({
					limit: async () => [],
				}),
			}),
		}),
	}),
	insert: () => ({
		values: (data: any) => ({
			onConflictDoNothing: () => ({
				returning: async () => {
					const sessionId = data.txHash as string | undefined
					if (!sessionId) return [{ id: 1 }]
					if (consumedStripeSessions.has(sessionId)) return []
					consumedStripeSessions.add(sessionId)
					return [{ id: 1 }]
				},
			}),
			onConflictDoUpdate: async () => {
				if (data.lifetimePurchased !== undefined) creditGrantCount += 1
				return undefined
			},
		}),
	}),
}

const fakeDb: any = {
	transaction: async (callback: (tx: any) => Promise<any>) => callback(fakeTx),
}

const envLayer = Layer.succeed(
	EnvService,
	{ STRIPE_WEBHOOK_SECRET: 'whsec_route_test' } as any,
)
const stripeLayer = Layer.succeed(
	StripeService,
	{
		constructWebhookEvent: (payload: string, signature: string) => {
			if (signature === 'invalid') {
				return Effect.fail(new Error('Webhook signature verification failed'))
			}
			return Effect.try({
				try: () => JSON.parse(payload) as any,
				catch: () => new Error('Malformed webhook payload'),
			})
		},
	} as any,
)
const dbLayer = Layer.succeed(DrizzleService, Option.some(fakeDb as never))
const testLayer = Layer.mergeAll(envLayer, stripeLayer, dbLayer)

const runTestEffect = (effect: any) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

mock.module('../runtime', () => ({
	runEffect: runTestEffect,
	runEffectEither: (effect: any) => runTestEffect(Effect.either(effect)),
	shutdownRuntime: async () => {},
}))

let billingRoutes: any

beforeAll(async () => {
	;({ billingRoutes } = await import('../routes/billing'))
})

beforeEach(() => {
	consumedStripeSessions.clear()
	creditGrantCount = 0
})

afterAll(() => {
	mock.module('../runtime', () => REAL_RUNTIME)
})

function creditCheckoutEvent(sessionId: string, creditUsd: string, userId = '1') {
	return JSON.stringify({
		id: `evt_${sessionId}`,
		type: 'checkout.session.completed',
		data: {
			object: {
				id: sessionId,
				metadata: { user_id: userId, kind: 'credits', credit_usd: creditUsd },
			},
		},
	})
}

async function postWebhook(payload: string, signature: string) {
	return billingRoutes.request('/stripe/webhook', {
		method: 'POST',
		headers: { 'stripe-signature': signature },
		body: payload,
	})
}

describe('POST /billing/stripe/webhook — signature + replay protection', () => {
	it('rejects a webhook whose signature cannot be verified', async () => {
		const res = await postWebhook(creditCheckoutEvent('session_invalid_sig', '50'), 'invalid')

		expect(res.status).toBe(400)
		expect(creditGrantCount).toBe(0)
	})

	it('accepts a verified credit checkout and grants it once', async () => {
		const sessionId = 'session_valid_123'
		const res = await postWebhook(creditCheckoutEvent(sessionId, '50'), 'valid_sig_xyz')

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.received).toBe(true)
		expect(consumedStripeSessions.has(sessionId)).toBe(true)
		expect(creditGrantCount).toBe(1)
	})

	it('acknowledges a replay without granting the same Stripe session twice', async () => {
		const sessionId = 'session_replay_attack_123'
		const payload = creditCheckoutEvent(sessionId, '100', '2')

		const first = await postWebhook(payload, 'valid_sig_xyz')
		const replay = await postWebhook(payload, 'valid_sig_xyz')

		expect(first.status).toBe(200)
		expect(replay.status).toBe(200)
		expect(consumedStripeSessions.has(sessionId)).toBe(true)
		expect(creditGrantCount).toBe(1)
	})

	it('acknowledges malformed credit metadata without granting funds', async () => {
		const sessionId = 'session_bad_metadata_123'
		const res = await postWebhook(
			creditCheckoutEvent(sessionId, 'not-a-number', '3'),
			'valid_sig_xyz',
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.received).toBe(true)
		expect(consumedStripeSessions.has(sessionId)).toBe(false)
		expect(creditGrantCount).toBe(0)
	})
})
