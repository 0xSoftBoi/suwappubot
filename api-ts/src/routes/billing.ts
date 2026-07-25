import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import type Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { EnvService } from '../config/EnvService'
import { PURCHASABLE_TIERS, SUBSCRIPTION_PERIOD_DAYS, TIER_PRICES_USD } from '../config/constants'
import { requireDb, subscriptions, wallets, webCheckouts, x402Payments } from '../db'
import { mapErrorToResponse, ValidationError } from '../errors'
import { assertSenderBound, consumePayment } from '../lib/paymentConsumption'
import { verifyX402Payment } from '../lib/x402Verify'
import { telegramAuth } from '../middleware'
import { ipRateLimit } from '../middleware/ipRateLimit'
import { runEffectEither } from '../runtime'
import { StripeService } from '../services/StripeService'
import { UserService } from '../services'
import { auditLog } from '../services/audit'

export const billingRoutes = new Hono()

// Process-global (all-IPs) sliding-window cap on web-checkout session
// creation. ipRateLimit() below already bounds any single IP, but a
// distributed client (botnet / rotating proxies) could still fan out across
// many IPs and hammer Stripe session creation. This is a coarse circuit
// breaker on top, env-tunable, reset per minute.
const WEB_CHECKOUT_GLOBAL_LIMIT_PER_MIN = Math.max(
	1,
	Number(process.env.WEB_CHECKOUT_GLOBAL_LIMIT_PER_MIN) || 60,
)
let webCheckoutGlobalWindowStart = Date.now()
let webCheckoutGlobalCount = 0

function checkWebCheckoutGlobalCap(): boolean {
	const now = Date.now()
	if (now - webCheckoutGlobalWindowStart >= 60_000) {
		webCheckoutGlobalWindowStart = now
		webCheckoutGlobalCount = 0
	}
	webCheckoutGlobalCount += 1
	return webCheckoutGlobalCount <= WEB_CHECKOUT_GLOBAL_LIMIT_PER_MIN
}

const FEE_RATES: Record<string, number> = {
	free: 1.0,
	pro: 0.5,
	premium: 0.3,
	enterprise: 0.1,
}

// GET /billing/stripe/checkout?tier=pro[&format=json]
// Creates a Stripe checkout session. By default redirects to it (direct-link
// flow); with ?format=json (or Accept: application/json) returns { url } so the
// Telegram Mini App can open it via WebApp.openLink (a redirect can't be
// followed cross-origin from a fetch).
billingRoutes.get('/stripe/checkout', ipRateLimit(5), telegramAuth(), async (c) => {
	const tier = c.req.query('tier') as 'pro' | 'premium'
	if (!['pro', 'premium'].includes(tier)) {
		return c.json({ error: 'Invalid tier. Must be pro or premium.' }, 400)
	}

	const wantsJson =
		c.req.query('format') === 'json' ||
		(c.req.header('accept') ?? '').includes('application/json')

	const telegramUser = c.get('telegramUser')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const stripeService = yield* StripeService
			const userService = yield* UserService

			// Resolve the real DB user ID — TelegramUser only carries the Telegram id
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new Error('User not found'))
			}
			const dbUserId = userOption.value.id

			const baseUrl =
				env.ALLOWED_ORIGINS?.split(',')[0]?.trim() || 'https://app.suwappu.bot'

			const checkoutUrl = yield* stripeService.createCheckoutSession({
				tier,
				telegramId: String(telegramUser.id),
				userId: dbUserId,
				successUrl: `${baseUrl}/premium?upgrade=success&tier=${tier}`,
				cancelUrl: `${baseUrl}/premium`,
			})

			return { url: checkoutUrl }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	if (wantsJson) return c.json({ url: result.right.url })
	return c.redirect(result.right.url)
})

// GET /billing/checkout-web?tier=pro|premium[&format=json]
// Public (no telegram/webapp auth) checkout entry point for anonymous
// showcase visitors — used by the pricing page CTA. Stripe collects the
// email on its hosted page; we never see the visitor's identity up front.
// NOTE (account-linking gap): the resulting subscription is recorded in
// `web_checkouts` keyed by Stripe customer/email, NOT in `subscriptions`
// (whose user_id is NOT NULL/unique and has no value for an anonymous
// visitor). Promoting a web_checkouts row into a real subscriptions row
// once the visitor creates/links a Suwappu account is NOT built yet — see
// db/schema/webCheckouts.ts for the intended flow.
billingRoutes.get('/stripe/checkout-web', ipRateLimit(10), async (c) => {
	// Browsers/link-unfurlers may speculatively prefetch this GET (rel=prefetch,
	// Chrome's Speculation Rules, etc.) — since the request has a real side
	// effect (a Stripe checkout session), reject obvious prefetch requests
	// instead of silently creating throwaway sessions.
	const purpose = c.req.header('sec-purpose') ?? c.req.header('purpose') ?? ''
	if (purpose.toLowerCase().includes('prefetch')) {
		return c.body(null, 204)
	}

	if (!checkWebCheckoutGlobalCap()) {
		return c.json(
			{ error: 'Checkout is temporarily rate-limited globally. Please try again shortly.' },
			429,
		)
	}

	const tier = c.req.query('tier') as 'pro' | 'premium'
	if (!['pro', 'premium'].includes(tier)) {
		return c.json({ error: 'Invalid tier. Must be pro or premium.' }, 400)
	}

	const wantsJson =
		c.req.query('format') === 'json' ||
		(c.req.header('accept') ?? '').includes('application/json')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const stripeService = yield* StripeService
			const db = yield* requireDb

			const showcaseBaseUrl = env.SHOWCASE_BASE_URL || 'https://suwappu.bot'

			const session = yield* stripeService.createWebCheckoutSession({
				tier,
				successUrl: `${showcaseBaseUrl}/pricing?checkout=success&tier=${tier}`,
				cancelUrl: `${showcaseBaseUrl}/pricing?checkout=cancel`,
			})

			// Best-effort pre-insert so the row exists before the visitor even
			// reaches Stripe. NOT relied upon as the source of truth — the
			// webhook below upserts (insert ... onConflictDoUpdate) on
			// stripeSessionId, so a missed/failed insert here self-heals when
			// Stripe delivers checkout.session.completed.
			yield* Effect.tryPromise({
				try: () =>
					db
						.insert(webCheckouts)
						.values({
							stripeSessionId: session.sessionId,
							tier,
							status: 'pending',
						})
						.onConflictDoNothing({ target: webCheckouts.stripeSessionId }),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			return { url: session.url }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	if (wantsJson) return c.json({ url: result.right.url })
	return c.redirect(result.right.url)
})

// POST /billing/stripe/webhook
// Stripe sends payment events here — upgrades the user's tier on success
billingRoutes.post('/stripe/webhook', async (c) => {
	const body = await c.req.text()
	const signature = c.req.header('stripe-signature') ?? ''

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const stripeService = yield* StripeService
			const db = yield* requireDb

			if (!env.STRIPE_WEBHOOK_SECRET) {
				return { received: true }
			}

			// Support multiple signing secrets (comma-separated) so more than one
			// Stripe webhook endpoint — or an in-flight key rotation — can target this
			// URL. Stripe signs each delivery with its own endpoint's secret, so we try
			// each configured secret until one verifies.
			const secrets = env.STRIPE_WEBHOOK_SECRET.split(',')
				.map((s) => s.trim())
				.filter(Boolean)

			let event: Stripe.Event | null = null
			for (const secret of secrets) {
				const verified = yield* Effect.either(
					stripeService.constructWebhookEvent(body, signature, secret),
				)
				if (Either.isRight(verified)) {
					event = verified.right
					break
				}
			}
			if (!event) {
				return yield* Effect.fail(new Error('Webhook signature verification failed'))
			}

			if (event.type === 'checkout.session.completed') {
				const session = event.data.object as {
					id: string
					customer?: string | null
					customer_email?: string | null
					customer_details?: { email?: string | null } | null
					metadata?: { telegram_id?: string; user_id?: string; tier?: string; source?: string }
				}
				const { user_id, tier, source } = session.metadata ?? {}

				// Anonymous web-visitor checkout (no Suwappu account yet). Record it
				// in web_checkouts keyed by the Stripe session, and stamp whatever
				// email/customer id Stripe collected. This is intentionally NOT
				// written into `subscriptions` — see the account-linking gap noted
				// in db/schema/webCheckouts.ts.
				if (source === 'web' && tier) {
					const email = session.customer_email ?? session.customer_details?.email ?? null
					const tierValue = tier as 'pro' | 'premium'

					// Check first so we can log loudly if the pre-checkout insert
					// (in GET /stripe/checkout-web) never landed — that's the
					// "expected" row this webhook should just be updating.
					const existing = yield* Effect.tryPromise({
						try: () =>
							db
								.select({ id: webCheckouts.id })
								.from(webCheckouts)
								.where(eq(webCheckouts.stripeSessionId, session.id))
								.limit(1),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					})

					if (!existing[0]) {
						yield* Effect.logWarning(
							`web checkout webhook: no pre-checkout row for session ${session.id} (tier=${tierValue}) — the GET /stripe/checkout-web insert was missing or failed; webhook is creating it now`,
						)
					}

					// Upsert keyed on stripeSessionId — the webhook is the source of
					// truth regardless of whether the pre-checkout insert landed.
					yield* Effect.tryPromise({
						try: () =>
							db
								.insert(webCheckouts)
								.values({
									stripeSessionId: session.id,
									tier: tierValue,
									status: 'active',
									stripeCustomerId: session.customer ?? null,
									customerEmail: email,
								})
								.onConflictDoUpdate({
									target: webCheckouts.stripeSessionId,
									set: {
										status: 'active',
										stripeCustomerId: session.customer ?? null,
										customerEmail: email,
										updatedAt: new Date(),
									},
								}),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					})

					yield* auditLog({
						userId: 0,
						eventType: 'subscription.web_checkout_completed',
						details: {
							tier,
							source: 'stripe_web',
							eventId: event.id,
							sessionId: session.id,
							stripeCustomerId: session.customer ?? null,
						},
					})
				}

				if (user_id && tier) {
					const expiresAt = new Date()
					expiresAt.setMonth(expiresAt.getMonth() + 1)

					yield* Effect.tryPromise({
						try: () =>
							db
								.insert(subscriptions)
								.values({
									userId: parseInt(user_id, 10),
									tier,
									startedAt: new Date(),
									expiresAt,
								})
								.onConflictDoUpdate({
									target: subscriptions.userId,
									set: {
										tier,
										startedAt: new Date(),
										expiresAt,
										updatedAt: new Date(),
									},
								}),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					})

					yield* auditLog({
						userId: parseInt(user_id, 10),
						eventType: 'subscription.activated',
						details: { tier, source: 'stripe', eventId: event.id },
					})
				}
			}

			if (event.type === 'customer.subscription.deleted') {
				const sub = event.data.object as { metadata?: { user_id?: string } }
				const userId = sub.metadata?.user_id
				if (userId) {
					yield* Effect.tryPromise({
						try: () =>
							db
								.update(subscriptions)
								.set({ tier: 'free', expiresAt: new Date(), updatedAt: new Date() })
								.where(eq(subscriptions.userId, parseInt(userId, 10))),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					})

					yield* auditLog({
						userId: parseInt(userId, 10),
						eventType: 'subscription.canceled',
						details: { source: 'stripe', eventId: event.id },
					})
				}
			}

			if (event.type === 'invoice.payment_failed') {
				const invoice = event.data.object as {
					subscription_details?: { metadata?: { user_id?: string } }
					metadata?: { user_id?: string }
					next_payment_attempt?: number | null
				}
				const userId =
					invoice.subscription_details?.metadata?.user_id ?? invoice.metadata?.user_id
				// next_payment_attempt is null once Stripe stops retrying (final failure).
				const isTerminal = !invoice.next_payment_attempt

				// Always audit the failure (dunning visibility + SOC2 trail).
				yield* auditLog({
					userId: userId ? parseInt(userId, 10) : 0,
					eventType: 'subscription.payment_failed',
					details: { terminal: isTerminal, source: 'stripe', eventId: event.id },
				})

				// Downgrade ONLY on the final failed attempt, and only with a resolved
				// user — never downgrade a paying user mid-retry. Idempotent with the
				// customer.subscription.deleted handler above.
				if (isTerminal && userId) {
					yield* Effect.tryPromise({
						try: () =>
							db
								.update(subscriptions)
								.set({ tier: 'free', expiresAt: new Date(), updatedAt: new Date() })
								.where(eq(subscriptions.userId, parseInt(userId, 10))),
						catch: (e) => (e instanceof Error ? e : new Error(String(e))),
					})
				}
			}

			return { received: true }
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: 'Webhook processing failed' }, 400)
	return c.json(result.right)
})

// POST /billing/crypto - Crypto-native (USDC) subscription for human users.
// Verifies an on-chain USDC payment >= the tier price and grants the tier for
// SUBSCRIPTION_PERIOD_DAYS. Idempotent on (chain, txHash) via x402_payments.
// Body: { txHash, chain, amount, tier }. This is the wallet-pay alternative to
// the Stripe checkout flow above and resolves to the same subscriptions row.
const CryptoSubSchema = z.object({
	txHash: z.string().min(4).max(128),
	chain: z.string().min(2).max(32).default('base'),
	amount: z.number().positive(),
	tier: z.enum(['pro', 'premium', 'enterprise']),
})

billingRoutes.post('/crypto', ipRateLimit(10), telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser')

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400)
	}
	const parsed = CryptoSubSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ error: 'Validation error', fields: parsed.error.flatten() }, 400)
	}
	const { txHash, chain, amount, tier } = parsed.data
	const price = TIER_PRICES_USD[tier]
	if (price === undefined) {
		return c.json({ error: `Unknown tier: ${tier}`, purchasable: PURCHASABLE_TIERS }, 400)
	}
	if (amount + 1e-9 < price) {
		return c.json({ error: `Insufficient payment: ${tier} costs $${price}/30d, paid $${amount}` }, 400)
	}

	const paymentId = `sub:${chain}:${txHash}`

	const result = await runEffectEither(
		Effect.gen(function* () {
			const env = yield* EnvService
			const db = yield* requireDb
			const userService = yield* UserService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new ValidationError({ message: 'User not found' }))
			}
			const dbUserId = userOption.value.id

			// 1) Idempotency pre-check on (chain, txHash).
			const existing = yield* Effect.tryPromise({
				try: () =>
					db.select().from(x402Payments).where(eq(x402Payments.paymentId, paymentId)).limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (existing[0]) {
				const [sub] = yield* Effect.tryPromise({
					try: () =>
						db.select().from(subscriptions).where(eq(subscriptions.userId, dbUserId)).limit(1),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})
				return { alreadyProcessed: true as const, tier: sub?.tier ?? tier, expiresAt: sub?.expiresAt ?? null }
			}

			// 2) Verify on-chain via the internal Python verifier (fail closed).
			if (!env.INTERNAL_API_KEY || !env.INTERNAL_API_URL) {
				return yield* Effect.fail(new ValidationError({ message: 'Payment verification is not configured' }))
			}
			const collector = env.AGENT_METERING_COLLECTOR_ADDRESS || env.FEE_WALLET_EVM
			const verification = yield* Effect.tryPromise({
				try: () =>
					verifyX402Payment({
						internalUrl: env.INTERNAL_API_URL as string,
						internalKey: env.INTERNAL_API_KEY as string,
						txHash,
						chain,
						expectedAmount: String(price),
						expectedToken: 'USDC',
						expectedRecipient: collector,
					}),
				catch: (e) => new ValidationError({ message: e instanceof Error ? e.message : String(e) }),
			})
			if (!verification.verified) {
				return yield* Effect.fail(
					new ValidationError({ message: verification.error || 'Payment not verified on-chain' }),
				)
			}

			// 2b) Sender-spoof defense: the on-chain payer MUST be one of THIS user's
			//     bound wallets. Otherwise anyone could submit another user's inbound
			//     payment txHash and be credited before the real payer.
			const userWallets = yield* Effect.tryPromise({
				try: () =>
					db.select({ address: wallets.address }).from(wallets).where(eq(wallets.userId, dbUserId)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			if (!assertSenderBound(verification.sender, userWallets.map((w) => w.address))) {
				return yield* Effect.fail(
					new ValidationError({
						message: 'Payment sender does not match any of your wallets (sender-spoof rejected).',
					}),
				)
			}

			// 3) Record payment (idempotent) + grant the subscription atomically.
			const now = new Date()
			// Prepaid window (no auto-renew): extend from current expiry if still active.
			const currentRows = yield* Effect.tryPromise({
				try: () =>
					db
						.select({ expiresAt: subscriptions.expiresAt })
						.from(subscriptions)
						.where(eq(subscriptions.userId, dbUserId))
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			const currentExpiry = currentRows[0]?.expiresAt
			const base =
				currentExpiry && new Date(currentExpiry).getTime() > now.getTime()
					? new Date(currentExpiry)
					: now
			const expiresAt = new Date(base.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000)

			const granted = yield* Effect.tryPromise({
				try: () =>
					db.transaction(async (tx) => {
						// Consume the payment in the SHARED (chain, txHash) ledger FIRST —
						// global replay / cross-table double-redeem guard (the per-table
						// x402_payments.paymentId guard only protects THIS table).
						const consumed = await consumePayment(tx, {
							chain,
							txHash,
							purpose: 'webapp_subscribe',
							consumedBy: String(dbUserId),
						})
						if (!consumed) return { credited: false as const }

						const ins = await tx
							.insert(x402Payments)
							.values({
								userId: dbUserId,
								paymentId,
								amount,
								tokenSymbol: 'USDC',
								chain,
								txHash,
								status: 'completed',
								productType: 'subscription',
								productId: tier,
								completedAt: now,
							})
							.onConflictDoNothing({ target: x402Payments.paymentId })
							.returning({ id: x402Payments.id })

						if (ins.length === 0) return { credited: false as const }

						await tx
							.insert(subscriptions)
							.values({ userId: dbUserId, tier, startedAt: now, expiresAt })
							.onConflictDoUpdate({
								target: subscriptions.userId,
								set: { tier, startedAt: now, expiresAt, updatedAt: now },
							})
						return { credited: true as const }
					}),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			return { alreadyProcessed: !granted.credited, tier, expiresAt }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}
	const r = result.right
	return c.json({
		success: true,
		already_processed: r.alreadyProcessed,
		tier: r.tier,
		expires_at: r.expiresAt,
		auto_renew: false,
		fee_rate_percent: FEE_RATES[r.tier ?? 'free'] ?? 1.0,
		message: r.alreadyProcessed
			? 'This payment was already processed (idempotent).'
			: `Prepaid ${r.tier} access window active (no auto-renew — pay again to extend).`,
	})
})

// GET /billing/status - current subscription tier and fee rate
billingRoutes.get('/status', telegramAuth(), async (c) => {
	const telegramUser = c.get('telegramUser')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			const userService = yield* UserService

			// Resolve the real DB user ID
			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
			if (Option.isNone(userOption)) {
				return {
					tier: 'free' as string,
					fee_rate_percent: FEE_RATES.free,
					expires_at: null as Date | null,
					active: true,
				}
			}
			const dbUserId = userOption.value.id

			const [sub] = yield* Effect.tryPromise({
				try: () =>
					db
						.select()
						.from(subscriptions)
						.where(eq(subscriptions.userId, dbUserId))
						.limit(1),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})

			const tier = sub?.tier ?? 'free'

			return {
				tier,
				fee_rate_percent: FEE_RATES[tier] ?? 1.0,
				expires_at: sub?.expiresAt ?? null,
				active: !sub?.expiresAt || sub.expiresAt > new Date(),
			}
		}),
	)

	if (Either.isLeft(result)) {
		return c.json({ tier: 'free', fee_rate_percent: 1.0, active: true })
	}
	return c.json(result.right)
})
