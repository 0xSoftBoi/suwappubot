import { Effect, Either, Option } from 'effect'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { EnvService } from '../config/EnvService'
import { requireDb, subscriptions } from '../db'
import { mapErrorToResponse } from '../errors'
import { telegramAuth } from '../middleware'
import { ipRateLimit } from '../middleware/ipRateLimit'
import { runEffectEither } from '../runtime'
import { StripeService } from '../services/StripeService'
import { UserService } from '../services'

export const billingRoutes = new Hono()

const FEE_RATES: Record<string, number> = {
	free: 1.0,
	pro: 0.5,
	premium: 0.3,
	enterprise: 0.1,
}

// GET /billing/stripe/checkout?tier=pro
// Creates a Stripe checkout session and redirects to it
billingRoutes.get('/stripe/checkout', ipRateLimit(5), telegramAuth(), async (c) => {
	const tier = c.req.query('tier') as 'pro' | 'premium'
	if (!['pro', 'premium'].includes(tier)) {
		return c.json({ error: 'Invalid tier. Must be pro or premium.' }, 400)
	}

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
				successUrl: `${baseUrl}/subscription/success?tier=${tier}`,
				cancelUrl: `${baseUrl}/subscription`,
			})

			return { url: checkoutUrl }
		}),
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

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

			const event = yield* stripeService.constructWebhookEvent(
				body,
				signature,
				env.STRIPE_WEBHOOK_SECRET,
			)

			if (event.type === 'checkout.session.completed') {
				const session = event.data.object as {
					metadata?: { telegram_id?: string; user_id?: string; tier?: string }
				}
				const { user_id, tier } = session.metadata ?? {}

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
				}
			}

			return { received: true }
		}),
	)

	if (Either.isLeft(result)) return c.json({ error: 'Webhook processing failed' }, 400)
	return c.json(result.right)
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
