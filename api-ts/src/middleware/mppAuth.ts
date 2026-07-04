import crypto from 'crypto'
import type { Context, Next } from 'hono'
import { Effect, Either } from 'effect'
import type { Env } from '../config/EnvService'
import { EnvService } from '../config/EnvService'
import { runEffectEither } from '../runtime'
import { TTLCache } from '../lib/cache'
import { requireDb } from '../db'
import { consumePayment } from '../lib/paymentConsumption'
import { verifyX402Payment } from '../lib/x402Verify'

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
 * MPP (Micropayment Protocol) auth middleware.
 * Returns HTTP 402 with payment challenge for unauthenticated requests.
 * Verifies X-Payment-Proof header for paid requests.
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

		// AP2-compliant headers
		c.header('x-402', Buffer.from(JSON.stringify(paymentChallenge)).toString('base64'))
		c.header('x-ap2-version', '1')

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

	// Verify payment on-chain via internal Python API (shared verifyX402Payment
	// helper — same parse every redemption path uses, so `sender` is available).
	const verification = await verifyX402Payment({
		internalUrl: env.INTERNAL_API_URL || 'http://localhost:8000',
		internalKey: env.INTERNAL_API_KEY || '',
		txHash: proof.tx_hash,
		chain: proof.chain || challenge.chain,
		expectedAmount: challenge.price,
		expectedToken: proof.token || challenge.token,
		expectedRecipient: challenge.paymentAddress,
	})
	if (!verification.verified) {
		return c.json({ error: verification.error || 'Payment not verified on-chain' }, 402)
	}

	// SECURITY (residual, documented): unlike the topup / subscribe / webapp-crypto
	// paths, the MPP 402 flow has NO per-caller wallet identity — a 402 challenge is
	// issued to an anonymous caller and keyed only by a random challenge_id, so there
	// is no bound wallet to compare `verification.sender` against. We therefore do NOT
	// call assertSenderBound() here. The replay guard below (single global consume of
	// the payment) still ensures each on-chain payment buys exactly one request; the
	// only residual is a first-come front-run — an observer who sees a valid tx_hash in
	// the mempool could race to spend it on their own single request before the payer.
	// That is an accepted residual for the anonymous MPP surface. `sender` is parsed
	// (via the shared helper) so that if per-caller MPP identity is ever added, binding
	// is a one-line change here.

	// SECURITY (replay): a stateless verifier lets an attacker reuse ONE valid tx
	// across N fresh 402 challenges (each challenge_id is distinct, so the
	// per-challenge cache below does NOT stop it). Atomically consume the payment
	// in the SHARED (chain, txHash) ledger — the same global guard the topup /
	// subscribe / webapp-crypto paths use — so a given on-chain payment buys
	// exactly one paid request. Fail closed if the DB is unavailable.
	const consumeChain = proof.chain || challenge.chain
	const dbResult = await runEffectEither(requireDb)
	if (Either.isLeft(dbResult)) {
		return c.json({ error: 'Payment ledger unavailable' }, 503)
	}
	let consumed: boolean
	try {
		consumed = await consumePayment(dbResult.right as any, {
			chain: consumeChain,
			txHash: proof.tx_hash,
			purpose: 'mpp_swap',
		})
	} catch (e: any) {
		return c.json({ error: `Payment ledger error: ${e.message}` }, 500)
	}
	if (!consumed) {
		return c.json(
			{ error: 'This payment has already been used. Each payment is valid for one request.' },
			402,
		)
	}

	// Payment verified & consumed — drop the challenge and proceed
	challengeCache.delete(proof.challenge_id)
	await next()
}
