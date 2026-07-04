import crypto from 'crypto'
import type { Context, Next } from 'hono'
import { Effect, Either } from 'effect'
import type { Env } from '../config/EnvService'
import { EnvService } from '../config/EnvService'
import { runEffectEither } from '../runtime'
import { TTLCache } from '../lib/cache'

interface PaymentChallenge {
	price: string
	token: string
	chain: string
	paymentAddress: string
}

interface PaymentProof {
	challenge_id: string
	tx_hash: string
	chain: string
	token: string
}

const CHALLENGE_TTL = 300_000 // 5 minutes
const challengeCache = new TTLCache<PaymentChallenge>(CHALLENGE_TTL, 50_000)

/**
 * Suwappu Micropayments (pathUSD) auth middleware — internal name "MPP" for
 * historical/env-var reasons ("mpp" prefix below), but this is a homegrown
 * pay-per-call 402 challenge/verify flow, NOT an implementation of Google's
 * AP2 (IntentMandate/CartMandate/PaymentMandate) or Stripe/Tempo's Machine
 * Payments Protocol. Do not describe it as compliant with either.
 *
 * Returns HTTP 402 with a payment challenge for unauthenticated requests.
 * Verifies the X-Payment-Proof header for paid requests.
 */
export function mppPaymentAuth() {
	return async (c: Context, next: Next) => {
		// Check if MPP is enabled
		const envResult = await runEffectEither(
			Effect.gen(function* () {
				return yield* EnvService
			}),
		)

		if (Either.isLeft(envResult)) {
			return c.json({ error: 'Internal configuration error' }, 500)
		}

		const env = envResult.right
		if (env.MPP_ENABLED !== 'true') {
			// MPP disabled — reject with 401 (caller should use bearer auth)
			return c.json({
				error: 'Authentication required',
				hint: 'Use Authorization: Bearer YOUR_API_KEY or enable MPP payments',
			}, 401)
		}

		// Check X-Payment-Proof header
		const paymentProofHeader = c.req.header('X-Payment-Proof')
		if (paymentProofHeader) {
			return await verifyPayment(c, next, paymentProofHeader, env)
		}

		// No payment proof — issue a 402 challenge
		const challengeId = crypto.randomUUID()
		const now = Date.now()
		const priceUsd = env.MPP_SWAP_PRICE_USD
		const paymentAddress = env.FEE_WALLET_EVM

		challengeCache.set(challengeId, {
			price: priceUsd,
			token: 'pathUSD',
			chain: 'tempo',
			paymentAddress,
		})

		const expiresAt = Math.floor((now + CHALLENGE_TTL) / 1000)
		const paymentChallenge = {
			service: 'suwappu-dex',
			price: { amount: priceUsd, token: 'pathUSD', chain: 'tempo' },
			payment_address: paymentAddress,
			payment_methods: ['mpp_one_time', 'x402_on_chain'],
			challenge_id: challengeId,
			expires_at: expiresAt,
		}

		// Suwappu Micropayments (pathUSD) 402 challenge header — base64-encoded JSON.
		// This is our own scheme, not an AP2 (Google) or Machine Payments Protocol
		// (Stripe/Tempo) header; do not add an x-ap2-version or similar claim here.
		c.header('x-402', Buffer.from(JSON.stringify(paymentChallenge)).toString('base64'))

		return c.json({ status: 402, payment_required: paymentChallenge }, 402)
	}
}

async function verifyPayment(c: Context, next: Next, proofHeader: string, env: Env) {
	let proof: PaymentProof
	try {
		proof = JSON.parse(Buffer.from(proofHeader, 'base64').toString('utf-8'))
	} catch {
		return c.json({ error: 'Invalid X-Payment-Proof: expected base64-encoded JSON' }, 400)
	}

	if (!proof.challenge_id || !proof.tx_hash) {
		return c.json({ error: 'X-Payment-Proof must include challenge_id and tx_hash' }, 400)
	}

	// Lookup challenge
	const challenge = challengeCache.get(proof.challenge_id)
	if (!challenge) {
		return c.json({ error: 'Payment challenge expired or not found. Request a new one.' }, 402)
	}

	// Verify payment on-chain via internal Python API
	try {
		const internalUrl = env.INTERNAL_API_URL || 'http://localhost:8000'
		const verifyRes = await fetch(`${internalUrl}/internal/x402/verify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Key': env.INTERNAL_API_KEY || '',
			},
			body: JSON.stringify({
				tx_hash: proof.tx_hash,
				chain: proof.chain || challenge.chain,
				expected_amount: challenge.price,
				expected_token: proof.token || challenge.token,
				expected_recipient: challenge.paymentAddress,
			}),
			signal: AbortSignal.timeout(15_000),
		})

		if (!verifyRes.ok) {
			const errText = await verifyRes.text().catch(() => verifyRes.statusText)
			return c.json({ error: `Payment verification failed: ${errText}` }, 402)
		}

		const verification = (await verifyRes.json()) as { verified?: boolean; error?: string }
		if (!verification.verified) {
			return c.json({ error: verification.error || 'Payment not verified on-chain' }, 402)
		}
	} catch (e: any) {
		return c.json({ error: `Payment verification error: ${e.message}` }, 500)
	}

	// Payment verified — consume the challenge and proceed
	challengeCache.delete(proof.challenge_id)
	await next()
}
