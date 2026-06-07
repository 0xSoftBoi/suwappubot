import Stripe from 'stripe'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../config/EnvService'

export class StripeService extends Context.Tag('StripeService')<
	StripeService,
	{
		createCheckoutSession: (params: {
			tier: 'pro' | 'premium'
			telegramId: string
			userId: number
			successUrl: string
			cancelUrl: string
		}) => Effect.Effect<string, Error>

		constructWebhookEvent: (
			payload: string,
			signature: string,
			secret: string,
		) => Effect.Effect<Stripe.Event, Error>

		handleSubscriptionActivated: (
			session: Stripe.Checkout.Session,
		) => Effect.Effect<void, Error>
	}
>() {}

export const StripeServiceLive = Layer.effect(
	StripeService,
	Effect.gen(function* () {
		const env = yield* EnvService

		// Return no-op service if Stripe not configured
		if (!env.STRIPE_SECRET_KEY) {
			return StripeService.of({
				createCheckoutSession: () =>
					Effect.fail(new Error('Stripe not configured')),
				constructWebhookEvent: () =>
					Effect.fail(new Error('Stripe not configured')),
				handleSubscriptionActivated: () => Effect.void,
			})
		}

		const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
			apiVersion: '2026-05-27.dahlia',
		})

		return StripeService.of({
			createCheckoutSession: ({ tier, telegramId, userId, successUrl, cancelUrl }) =>
				Effect.tryPromise({
					try: async () => {
						const priceId =
							tier === 'pro' ? env.STRIPE_PRO_PRICE_ID : env.STRIPE_PREMIUM_PRICE_ID
						if (!priceId)
							throw new Error(`No price ID configured for tier: ${tier}`)

						const session = await stripe.checkout.sessions.create({
							mode: 'subscription',
							payment_method_types: ['card'],
							line_items: [{ price: priceId, quantity: 1 }],
							metadata: {
								telegram_id: telegramId,
								user_id: String(userId),
								tier,
							},
							success_url: successUrl,
							cancel_url: cancelUrl,
						})
						if (!session.url) throw new Error('Stripe did not return a checkout URL')
						return session.url
					},
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),

			constructWebhookEvent: (payload, signature, secret) =>
				Effect.try({
					try: () => stripe.webhooks.constructEvent(payload, signature, secret),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),

			handleSubscriptionActivated: (_session) =>
				// Activation is handled in the webhook route — hook for future use
				Effect.void,
		})
	}),
)
