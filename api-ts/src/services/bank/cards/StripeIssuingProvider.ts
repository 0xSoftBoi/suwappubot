/**
 * Stripe Issuing adapter (M6). Shapes confirmed against docs.stripe.com
 * (issuing/controls/real-time-authorizations, issuing/elements, issuing transactions object):
 * - real-time auth: answer the `issuing_authorization.request` webhook within 2s with HTTP 200,
 *   header `Stripe-Version`, JSON body `{approved, amount?}`.
 * - ephemeral key: server exchanges a Stripe.js nonce (`issuing_card` + `nonce`, apiVersion >= 2020-03-02).
 * - transaction `amount` is signed: captures negative, refunds positive.
 * Webhook signatures are verified locally (HMAC-SHA256 over `${t}.${rawBody}`, 5 min tolerance).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { Effect } from 'effect'
import Stripe from 'stripe'
import { type BankError, bankErr } from '../errors'
import type {
	AuthorizationDecision,
	AuthorizationRequest,
	CardProvider,
	CardStatus,
	Fx,
	ProviderCard,
	ProviderTransaction,
	WebhookEvent,
} from './CardProvider'
import type { NativeControls } from './rules'

export const STRIPE_ISSUING_API_VERSION = '2026-05-27.dahlia'
const SIGNATURE_TOLERANCE_SEC = 300

export interface StripeIssuingConfig {
	secretKey: string | undefined
	enabled: string | undefined
	webhookSecret: string | undefined
}

const notConfigured = (missing: string): BankError =>
	bankErr('PROVIDER_NOT_CONFIGURED', `${missing} is not configured`, { missing })

const upstream = (op: string, e: unknown): BankError =>
	bankErr('UPSTREAM', `Stripe Issuing ${op} failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e })

export const isIssuingEnabled = (v: string | undefined): boolean => v === 'true' || v === '1'

/** Verify a Stripe-Signature header against the raw body. Pure (exported for round-trip checks). */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSec: number): boolean {
	if (!header) return false
	let t: string | undefined
	const sigs: string[] = []
	for (const part of header.split(',')) {
		const i = part.indexOf('=')
		if (i < 0) continue
		const k = part.slice(0, i).trim()
		const v = part.slice(i + 1).trim()
		if (k === 't') t = v
		else if (k === 'v1') sigs.push(v)
	}
	if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false
	if (Math.abs(nowSec - Number(t)) > SIGNATURE_TOLERANCE_SEC) return false
	const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest()
	return sigs.some((s) => {
		if (!/^[0-9a-f]{64}$/i.test(s)) return false
		return timingSafeEqual(expected, Buffer.from(s, 'hex'))
	})
}

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const idOf = (v: unknown): string | null => (typeof v === 'string' ? v : str(asObj(v).id))
const bigOf = (v: unknown): bigint | null => (typeof v === 'number' && Number.isSafeInteger(v) ? BigInt(v) : null)

function parseTransaction(o: Obj): ProviderTransaction | null {
	const signed = bigOf(o.amount)
	const cardId = idOf(o.card)
	const id = str(o.id)
	if (signed === null || signed === 0n || !cardId || !id) return null
	const m = asObj(o.merchant_data)
	return {
		providerTransactionId: id,
		providerAuthorizationId: idOf(o.authorization),
		providerCardId: cardId,
		type: signed < 0n ? 'capture' : 'refund',
		amountMinor: signed < 0n ? -signed : signed,
		currency: (str(o.currency) ?? 'usd').toUpperCase(),
		merchantName: str(m.name),
		mcc: str(m.category_code),
		merchantCountry: str(m.country),
		createdAt: typeof o.created === 'number' ? o.created * 1000 : Date.now(),
	}
}

function parseRequest(o: Obj): AuthorizationRequest | null {
	const pr = asObj(o.pending_request)
	const amount = bigOf(pr.amount)
	const cardId = idOf(o.card)
	const id = str(o.id)
	if (amount === null || !cardId || !id) return null
	const m = asObj(o.merchant_data)
	return {
		providerAuthorizationId: id,
		providerCardId: cardId,
		amountMinor: amount,
		currency: (str(pr.currency) ?? str(o.currency) ?? 'usd').toUpperCase(),
		merchantAmountMinor: bigOf(pr.merchant_amount),
		merchantCurrency: str(pr.merchant_currency)?.toUpperCase() ?? null,
		merchantName: str(m.name),
		mcc: str(m.category_code),
		merchantCountry: str(m.country),
		amountControllable: pr.is_amount_controllable === true,
		createdAt: typeof o.created === 'number' ? o.created * 1000 : Date.now(),
	}
}

export function makeStripeIssuingProvider(cfg: StripeIssuingConfig): CardProvider {
	let client: Stripe | null = null
	const stripe = (): Effect.Effect<Stripe, BankError> => {
		if (!isIssuingEnabled(cfg.enabled)) return Effect.fail(notConfigured('STRIPE_ISSUING_ENABLED'))
		if (!cfg.secretKey) return Effect.fail(notConfigured('STRIPE_SECRET_KEY'))
		client ??= new Stripe(cfg.secretKey, { apiVersion: STRIPE_ISSUING_API_VERSION })
		return Effect.succeed(client)
	}
	const api = <A>(op: string, f: (s: Stripe) => Promise<A>): Fx<A> =>
		Effect.flatMap(stripe(), (s) => Effect.tryPromise({ try: () => f(s), catch: (e) => upstream(op, e) }))

	const limits = (c: NativeControls, cur: string) => {
		const rows: Array<{ amount: number; interval: 'per_authorization' | 'daily' | 'weekly' | 'monthly' }> = []
		const add = (v: bigint | undefined, interval: 'per_authorization' | 'daily' | 'weekly' | 'monthly') => {
			if (v !== undefined && v <= BigInt(Number.MAX_SAFE_INTEGER)) rows.push({ amount: Number(v), interval })
		}
		add(c.perAuthorizationMinor, 'per_authorization')
		add(c.dailyMinor, 'daily')
		add(c.weeklyMinor, 'weekly')
		add(c.monthlyMinor, 'monthly')
		void cur
		return rows
	}
	// Stripe clears list params only when sent as an empty string.
	const clearable = <T>(v: T[]): T[] => (v.length ? v : ('' as unknown as T[]))
	const controls = (c: NativeControls, cur: string) => ({
		spending_limits: clearable(limits(c, cur)),
		allowed_merchant_countries: clearable(c.allowedCountries ?? []),
		blocked_merchant_countries: clearable(c.blockedCountries ?? []),
	})

	return {
		name: 'stripe',

		createCardholder: (i) =>
			api('createCardholder', async (s) => {
				const ch = await s.issuing.cardholders.create({
					type: 'individual',
					name: i.name,
					...(i.email ? { email: i.email } : {}),
					...(i.phoneNumber ? { phone_number: i.phoneNumber } : {}),
					status: 'active',
					billing: {
						address: {
							line1: i.billing.line1,
							...(i.billing.line2 ? { line2: i.billing.line2 } : {}),
							city: i.billing.city,
							...(i.billing.state ? { state: i.billing.state } : {}),
							postal_code: i.billing.postalCode,
							country: i.billing.country.toUpperCase(),
						},
					},
					...(i.individual
						? {
								individual: {
									first_name: i.individual.firstName,
									last_name: i.individual.lastName,
									dob: i.individual.dob,
									...(i.termsAcceptance
										? { card_issuing: { user_terms_acceptance: { date: i.termsAcceptance.date, ip: i.termsAcceptance.ip } } }
										: {}),
								},
							}
						: {}),
					...(i.metadata ? { metadata: i.metadata } : {}),
				})
				return { providerCardholderId: ch.id }
			}),

		issueCard: (i) =>
			api('issueCard', async (s): Promise<ProviderCard> => {
				const card = await s.issuing.cards.create(
					{
						cardholder: i.providerCardholderId,
						currency: i.currency.toLowerCase(),
						type: i.type,
						status: i.status,
						spending_controls: controls(i.controls, i.currency),
						metadata: i.metadata,
						...(i.type === 'physical' && i.shipping
							? {
									shipping: {
										name: i.shipping.name,
										address: {
											line1: i.shipping.line1,
											...(i.shipping.line2 ? { line2: i.shipping.line2 } : {}),
											city: i.shipping.city,
											...(i.shipping.state ? { state: i.shipping.state } : {}),
											postal_code: i.shipping.postalCode,
											country: i.shipping.country.toUpperCase(),
										},
										...(i.shipping.speed ? { speed: i.shipping.speed } : {}),
									},
								}
							: {}),
					},
					{ idempotencyKey: i.idempotencyKey },
				)
				return {
					providerCardId: card.id,
					status: card.status === 'active' ? 'active' : card.status === 'canceled' ? 'canceled' : 'inactive',
					brand: card.brand ?? null,
					last4: card.last4 ?? null,
					expMonth: card.exp_month ?? null,
					expYear: card.exp_year ?? null,
				}
			}),

		setStatus: (id, status: CardStatus) =>
			api('setStatus', async (s) => {
				await s.issuing.cards.update(id, { status: status === 'active' ? 'active' : status === 'frozen' ? 'inactive' : 'canceled' })
			}),

		updateSpendingControls: (id, c, cur) =>
			api('updateSpendingControls', async (s) => {
				await s.issuing.cards.update(id, { spending_controls: controls(c, cur) })
			}),

		ephemeralKey: ({ providerCardId, nonce }) =>
			api('ephemeralKey', async (s) => {
				const k = await s.ephemeralKeys.create({ nonce, issuing_card: providerCardId }, { apiVersion: '2020-03-02' })
				if (!k.secret) throw new Error('Stripe returned no ephemeral key secret')
				return { ephemeralKeySecret: k.secret, expiresAt: typeof k.expires === 'number' ? k.expires * 1000 : null }
			}),

		listTransactions: ({ providerCardId, limit, startingAfter }) =>
			api('listTransactions', async (s) => {
				const page = await s.issuing.transactions.list({
					card: providerCardId,
					limit,
					...(startingAfter ? { starting_after: startingAfter } : {}),
				})
				return page.data.map((t) => parseTransaction(t as unknown as Obj)).filter((t): t is ProviderTransaction => t !== null)
			}),

		verifyWebhook: (rawBody, header, nowSec = Math.floor(Date.now() / 1000)) =>
			Effect.gen(function* () {
				if (!cfg.webhookSecret) return yield* Effect.fail(notConfigured('STRIPE_ISSUING_WEBHOOK_SECRET'))
				if (!verifyStripeSignature(rawBody, header, cfg.webhookSecret, nowSec))
					return yield* Effect.fail(bankErr('FORBIDDEN', 'Invalid Stripe webhook signature'))
				let evt: Obj
				try {
					evt = JSON.parse(rawBody) as Obj
				} catch {
					return yield* Effect.fail(bankErr('VALIDATION', 'Webhook body is not JSON'))
				}
				const type = str(evt.type) ?? 'unknown'
				const obj = asObj(asObj(evt.data).object)
				if (type === 'issuing_authorization.request') {
					const request = parseRequest(obj)
					if (!request) return yield* Effect.fail(bankErr('VALIDATION', 'Malformed issuing_authorization.request payload'))
					return { kind: 'authorization_request', request } satisfies WebhookEvent
				}
				if (type === 'issuing_authorization.created' || type === 'issuing_authorization.updated') {
					const id = str(obj.id)
					const card = idOf(obj.card)
					if (!id || !card) return yield* Effect.fail(bankErr('VALIDATION', `Malformed ${type} payload`))
					return {
						kind: 'authorization_update',
						providerAuthorizationId: id,
						providerCardId: card,
						approved: obj.approved === true,
						status: str(obj.status) ?? 'pending',
						...(typeof obj.amount === 'number' && Number.isInteger(obj.amount) && obj.amount > 0 ? { amountMinor: BigInt(obj.amount) } : {}),
					} satisfies WebhookEvent
				}
				if (type === 'issuing_transaction.created') {
					const transaction = parseTransaction(obj)
					return transaction ? ({ kind: 'transaction', transaction } satisfies WebhookEvent) : ({ kind: 'ignored', type } satisfies WebhookEvent)
				}
				return { kind: 'ignored', type } satisfies WebhookEvent
			}),

		approve: (id, amount) =>
			api('approve', async (s) => {
				await s.issuing.authorizations.approve(id, amount !== undefined ? { amount: Number(amount) } : {})
			}),
		decline: (id) =>
			api('decline', async (s) => {
				await s.issuing.authorizations.decline(id)
			}),

		webhookResponse: (d: AuthorizationDecision) => ({
			status: 200,
			headers: { 'Stripe-Version': STRIPE_ISSUING_API_VERSION, 'Content-Type': 'application/json' },
			body: JSON.stringify({ approved: d.approved, ...(d.approved && d.amountMinor !== undefined ? { amount: Number(d.amountMinor) } : {}) }),
		}),
	}
}
