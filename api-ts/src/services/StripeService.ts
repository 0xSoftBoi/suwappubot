import Stripe from 'stripe'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../config/EnvService'

export class StripeService extends Context.Tag('StripeService')<
	StripeService,
	{
		createCheckoutSession: (params: {
			tier: 'pro' | 'premium' | 'enterprise'
			telegramId: string
			userId: number
			successUrl: string
			cancelUrl: string
		}) => Effect.Effect<string, Error>

		// Anonymous web-visitor variant — no pre-existing Suwappu user. Stripe
		// itself collects the email at checkout; we stamp source=web so the
		// webhook can tell this apart from the account-bound flow above and
		// record a pending (unlinked) checkout instead of a subscriptions row.
		createWebCheckoutSession: (params: {
			tier: 'pro' | 'premium' | 'enterprise'
			successUrl: string
			cancelUrl: string
		}) => Effect.Effect<{ url: string; sessionId: string }, Error>

		/**
		 * One-off card purchase of a prepaid API credit pack (mode: 'payment').
		 *
		 * MONEY-PATH: the USD balance granted comes from `credit_usd` in the
		 * session metadata, which the webhook re-reads. Both figures are derived
		 * from the server-side CREDIT_PACKS table, never from client input.
		 */
		createCreditCheckoutSession: (params: {
			packId: string
			chargeUsd: number
			balanceUsd: number
			userId: number
			telegramId: string
			customerId?: string | null
			successUrl: string
			cancelUrl: string
		}) => Effect.Effect<string, Error>

		/** Stripe-hosted billing portal — invoices, payment methods, cancellation. */
		createBillingPortalSession: (params: {
			customerId: string
			returnUrl: string
		}) => Effect.Effect<string, Error>

		/** Recent invoices for a customer, normalized for the dashboard. */
		listInvoices: (params: {
			customerId: string
			limit?: number
		}) => Effect.Effect<BillingInvoice[], Error>

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

/** Dashboard-facing invoice shape (no raw Stripe objects cross the API boundary). */
export interface BillingInvoice {
	id: string
	number: string | null
	status: string | null
	amountDueUsd: number
	amountPaidUsd: number
	currency: string
	createdAt: string | null
	hostedInvoiceUrl: string | null
	invoicePdfUrl: string | null
	description: string | null
}

export const StripeServiceLive = Layer.effect(
	StripeService,
	Effect.gen(function* () {
		const env = yield* EnvService

		// Return no-op service if Stripe not configured
		if (!env.STRIPE_SECRET_KEY) {
			return StripeService.of({
				createCheckoutSession: () =>
					Effect.fail(new Error('Stripe not configured')),
				createWebCheckoutSession: () =>
					Effect.fail(new Error('Stripe not configured')),
				createCreditCheckoutSession: () =>
					Effect.fail(new Error('Stripe not configured')),
				createBillingPortalSession: () =>
					Effect.fail(new Error('Stripe not configured')),
				listInvoices: () => Effect.fail(new Error('Stripe not configured')),
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
							// Also stamp the SUBSCRIPTION (and thus its invoices) so
							// subscription-level webhooks — customer.subscription.deleted and
							// invoice.payment_failed — can resolve the user. Session metadata
							// alone does NOT propagate to the subscription, which previously
							// left the downgrade handler unable to find user_id.
							subscription_data: {
								metadata: {
									telegram_id: telegramId,
									user_id: String(userId),
									tier,
								},
							},
							success_url: successUrl,
							cancel_url: cancelUrl,
						})
						if (!session.url) throw new Error('Stripe did not return a checkout URL')
						return session.url
					},
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),

			createWebCheckoutSession: ({ tier, successUrl, cancelUrl }) =>
				Effect.tryPromise({
					try: async () => {
						const priceId =
							tier === 'pro' ? env.STRIPE_PRO_PRICE_ID : env.STRIPE_PREMIUM_PRICE_ID
						if (!priceId)
							throw new Error(`No price ID configured for tier: ${tier}`)

						const session = await stripe.checkout.sessions.create({
							mode: 'subscription',
							payment_method_types: ['card'],
							// No pre-filled email — Stripe's hosted page collects it from
							// the anonymous web visitor.
							line_items: [{ price: priceId, quantity: 1 }],
							metadata: {
								tier,
								source: 'web',
							},
							subscription_data: {
								metadata: {
									tier,
									source: 'web',
								},
							},
							success_url: successUrl,
							cancel_url: cancelUrl,
						})
						if (!session.url) throw new Error('Stripe did not return a checkout URL')
						return { url: session.url, sessionId: session.id }
					},
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),

			createCreditCheckoutSession: ({
				packId,
				chargeUsd,
				balanceUsd,
				userId,
				telegramId,
				customerId,
				successUrl,
				cancelUrl,
			}) =>
				Effect.tryPromise({
					try: async () => {
						// One-off payment (not a subscription). Priced inline from the
						// server-side CREDIT_PACKS table so no Stripe price objects need
						// provisioning per pack.
						const session = await stripe.checkout.sessions.create({
							mode: 'payment',
							payment_method_types: ['card'],
							// In 'payment' mode Stripe does NOT create a Customer by
							// default, so a first-time credit buyer would end up with no
							// customer id — leaving the billing portal and invoice list
							// permanently empty for them. Force creation when we have no
							// customer on file yet.
							...(customerId
								? { customer: customerId }
								: { customer_creation: 'always' as const }),
							line_items: [
								{
									quantity: 1,
									price_data: {
										currency: 'usd',
										unit_amount: Math.round(chargeUsd * 100),
										product_data: {
											name: `Suwappu API credits — $${balanceUsd.toLocaleString()} balance`,
											description: `Prepaid metered API usage (pack: ${packId})`,
										},
									},
								},
							],
							// `kind` is what the webhook switches on; `credit_usd` is the
							// authoritative grant amount in USD (re-read server-side,
							// never recomputed from the charged amount).
							metadata: {
								kind: 'credits',
								pack_id: packId,
								credit_usd: String(balanceUsd),
								user_id: String(userId),
								telegram_id: telegramId,
							},
							success_url: successUrl,
							cancel_url: cancelUrl,
						})
						if (!session.url) throw new Error('Stripe did not return a checkout URL')
						return session.url
					},
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),

			createBillingPortalSession: ({ customerId, returnUrl }) =>
				Effect.tryPromise({
					try: async () => {
						const session = await stripe.billingPortal.sessions.create({
							customer: customerId,
							return_url: returnUrl,
						})
						if (!session.url) throw new Error('Stripe did not return a portal URL')
						return session.url
					},
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				}),

			listInvoices: ({ customerId, limit = 12 }) =>
				Effect.tryPromise({
					try: async () => {
						const res = await stripe.invoices.list({
							customer: customerId,
							limit: Math.min(Math.max(limit, 1), 50),
						})
						return res.data.map(
							(inv): BillingInvoice => ({
								id: inv.id ?? '',
								number: inv.number ?? null,
								status: inv.status ?? null,
								amountDueUsd: (inv.amount_due ?? 0) / 100,
								amountPaidUsd: (inv.amount_paid ?? 0) / 100,
								currency: (inv.currency ?? 'usd').toUpperCase(),
								createdAt: inv.created
									? new Date(inv.created * 1000).toISOString()
									: null,
								hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
								invoicePdfUrl: inv.invoice_pdf ?? null,
								description: inv.description ?? null,
							}),
						)
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
