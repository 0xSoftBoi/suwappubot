import crypto from 'node:crypto'
import { Effect, Either } from 'effect'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { EnvService } from '../config/EnvService'
import { requireDb } from '../db/DrizzleService'
import { agents } from '../db/schema'
import { runEffectEither } from '../runtime'
import { decodePayment, type X402ServiceEnv } from '../services/X402ResourceService'
import { ipRateLimit } from './ipRateLimit'
import {
	buildX402Challenge,
	costForEndpoint,
	extractPayerAddress,
	setX402Headers,
} from './x402Payment'

/**
 * Keyless x402 access — "your wallet is your API key".
 *
 * The x402 ecosystem norm (CoW x402.cow.fi, 0x via AgentPay, Zerion, EmblemAI)
 * is NO sign-up: an agent hits the URL, gets a 402, pays, gets data. Our agent
 * API used to demand a Suwappu API key before metering even ran, so keyless
 * x402 buyers (and Bazaar crawlers) could never use it.
 *
 * Flow for an eligible read endpoint with no Authorization header:
 *   - no payment header  → x402 v2 402 challenge (price discovery)
 *   - PAYMENT-SIGNATURE  → an EPHEMERAL per-wallet agent is put in context
 *     (negative id derived from the payer address, so rate limits are per
 *     wallet and credit deduction finds no row), then meteredPayment settles
 *     the payment (screening + verified-payer binding included). Only AFTER a
 *     successful settle does meteredPayment call materializeWalletAgent() to
 *     upsert a real `agents` row for that wallet — unpaid probes create
 *     nothing.
 *
 * Execution endpoints are NOT eligible: moving funds stays behind API keys,
 * scopes and the approvals flow.
 */

export const KEYLESS_ENDPOINTS = new Set(['quote', 'prices', 'portfolio', 'swap/simulate'])

export type KeylessMarker = { payer: string }

/**
 * Per-IP throttle on the keyless paid path (money-path review M1). The
 * per-wallet rate limit keys on a payer address the caller merely CLAIMS until
 * verification, so on its own it can be dodged by rotating `from` — the IP
 * limit bounds facilitator verify calls from any one source.
 */
const keylessIpLimit = ipRateLimit(60)

/** Stable negative pseudo-id per wallet (never collides with serial ids). */
function ephemeralIdFor(addr: string): number {
	const h = crypto.createHash('sha256').update(addr.toLowerCase()).digest()
	return -(h.readUInt32BE(0) & 0x7fffffff || 1)
}

/**
 * Wrap an existing auth middleware: bearer/JWT callers go through `inner`
 * untouched; keyless x402 callers on an eligible endpoint take the wallet path.
 */
export function withX402Keyless(
	inner: MiddlewareHandler,
	endpointFor: (path: string) => string | null,
): MiddlewareHandler {
	return async (c: Context, next: Next) => {
		const endpoint = endpointFor(c.req.path)
		if (!endpoint || !KEYLESS_ENDPOINTS.has(endpoint) || c.req.header('Authorization')) {
			return inner(c, next)
		}
		// MPP proof → let the existing MPP path handle it.
		if (c.req.header('X-Payment-Proof')) return inner(c, next)

		const env = await runEffectEither(
			Effect.gen(function* () {
				return yield* EnvService
			}),
		)
		if (
			Either.isLeft(env) ||
			env.right.AGENT_METERING_ENABLED !== 'true' ||
			env.right.X402_FACILITATOR_ENABLED !== 'true'
		) {
			return inner(c, next)
		}

		const header = c.req.header('PAYMENT-SIGNATURE') ?? c.req.header('X-PAYMENT')
		const payload = header ? decodePayment(header) : null
		const payer = payload
			? extractPayerAddress(payload as unknown as Parameters<typeof extractPayerAddress>[0])
			: undefined

		if (!payload || !payer || !/^0x[0-9a-fA-F]{40}$/.test(payer)) {
			// Price discovery: answer with the v2 challenge, not a 401.
			const cost = costForEndpoint(endpoint)
			const challenge = buildX402Challenge(env.right, {
				cost,
				resource: c.req.path,
				description: `Suwappu ${endpoint} — keyless x402 (${cost} credit${cost === 1 ? '' : 's'})`,
				error: header ? 'invalid_payment' : 'payment_required',
			})
			setX402Headers(c, env.right, challenge)
			return c.json({ ...challenge, keyless: true }, 402)
		}

		// IP throttle first; only then take the per-wallet path.
		let throttled: Response | undefined
		let passed = false
		const r = await keylessIpLimit(c, async () => {
			passed = true
		})
		if (!passed) {
			throttled = r as Response | undefined
			return throttled ?? c.json({ error: 'rate_limited' }, 429)
		}

		c.set('agent', {
			id: ephemeralIdFor(payer),
			uuid: `x402:${payer.toLowerCase()}`,
			name: `x402:${payer.toLowerCase()}`,
			rateLimitTier: 'free',
			isActive: true,
			metadata: { wallet: payer.toLowerCase(), source: 'x402-keyless', ephemeral: true },
		} as never)
		c.set('x402Keyless' as never, { payer: payer.toLowerCase() } satisfies KeylessMarker as never)
		await next()
	}
}

/**
 * Upsert the persistent wallet agent once a keyless payment has SETTLED.
 * Returns the row (or null on DB failure — the paid call still proceeds on the
 * ephemeral identity rather than failing a request the caller already paid for).
 */
export async function materializeWalletAgent(payer: string) {
	const addr = payer.toLowerCase()
	const r = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			return yield* Effect.tryPromise({
				try: () =>
					db
						.insert(agents)
						.values({
							name: `x402:${addr}`,
							description: 'Keyless x402 wallet agent (auto-created on first paid call)',
							apiKey: `x402_wallet_${addr}`,
							// Unusable key: hash of random bytes — keyless agents auth by paying.
							apiKeyHash: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
							metadata: { wallet: addr, source: 'x402-keyless' },
						})
						.onConflictDoUpdate({ target: agents.name, set: { updatedAt: new Date() } as never })
						.returning(),
				catch: (e) => new Error(String(e)),
			})
		}),
	)
	return Either.isRight(r) ? (r.right[0] ?? null) : null
}

export type { X402ServiceEnv }
