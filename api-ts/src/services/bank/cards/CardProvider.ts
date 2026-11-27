/**
 * Card issuing provider port (M6). Adapters: StripeIssuingProvider, RainProvider.
 * No PAN/CVC ever crosses this interface: reveal is client-side via ephemeral key.
 */
import type { Effect } from 'effect'
import type { BankError } from '../errors'
import type { NativeControls } from './rules'

export type CardProviderName = 'stripe' | 'rain'
export type CardStatus = 'active' | 'frozen' | 'canceled'
export type Fx<A> = Effect.Effect<A, BankError>

export interface CardholderInput {
	name: string
	email?: string | undefined
	phoneNumber?: string | undefined
	billing: { line1: string; line2?: string | undefined; city: string; state?: string | undefined; postalCode: string; country: string }
	individual?: { firstName: string; lastName: string; dob: { day: number; month: number; year: number } } | undefined
	/** Server-captured terms acceptance (unix seconds + client IP). Required by Stripe for individuals. */
	termsAcceptance?: { date: number; ip: string } | undefined
	metadata?: Record<string, string> | undefined
}

export interface IssueCardInput {
	providerCardholderId: string
	type: 'virtual' | 'physical'
	currency: string
	status: 'active' | 'inactive'
	controls: NativeControls
	shipping?:
		| { name: string; line1: string; line2?: string | undefined; city: string; state?: string | undefined; postalCode: string; country: string; speed?: 'standard' | 'express' | 'priority' | undefined }
		| undefined
	metadata: Record<string, string>
	idempotencyKey: string
}

export interface ProviderCard {
	providerCardId: string
	status: CardStatus | 'inactive'
	brand: string | null
	last4: string | null
	expMonth: number | null
	expYear: number | null
}

export interface ProviderTransaction {
	providerTransactionId: string
	providerAuthorizationId: string | null
	providerCardId: string
	type: 'capture' | 'refund'
	/** Positive card-currency minor units (sign stripped; direction is `type`). */
	amountMinor: bigint
	currency: string
	merchantName: string | null
	mcc: string | null
	merchantCountry: string | null
	createdAt: number
}

export interface AuthorizationRequest {
	providerAuthorizationId: string
	providerCardId: string
	/** Amount in the CARDHOLDER currency (what the program is on the hook for). */
	amountMinor: bigint
	currency: string
	merchantAmountMinor: bigint | null
	merchantCurrency: string | null
	merchantName: string | null
	mcc: string | null
	merchantCountry: string | null
	/** True when the issuer may approve a partial amount. */
	amountControllable: boolean
	createdAt: number
}

export type WebhookEvent =
	| { kind: 'authorization_request'; request: AuthorizationRequest }
	| {
			kind: 'authorization_update'
			providerAuthorizationId: string
			providerCardId: string
			approved: boolean
			/** Provider status normalized: pending | closed | reversed | expired. */
			status: string
			/** Currently authorized amount (provider currency minor units) when the provider reports it; used for incremental authorizations. */
			amountMinor?: bigint | undefined
	  }
	| { kind: 'transaction'; transaction: ProviderTransaction }
	| { kind: 'ignored'; type: string }

export interface AuthorizationDecision {
	approved: boolean
	/** Approve for a smaller amount (only when amountControllable). */
	amountMinor?: bigint | undefined
}

/** Synchronous HTTP answer to a real-time authorization webhook. */
export interface WebhookHttpResponse {
	status: number
	headers: Record<string, string>
	body: string
}

export interface CardProvider {
	readonly name: CardProviderName
	createCardholder: (i: CardholderInput) => Fx<{ providerCardholderId: string }>
	issueCard: (i: IssueCardInput) => Fx<ProviderCard>
	setStatus: (providerCardId: string, status: CardStatus) => Fx<void>
	/** Mirror the enforceable rule subset into provider-native spending controls. */
	updateSpendingControls: (providerCardId: string, controls: NativeControls, currency: string) => Fx<void>
	/** Exchange a client-created nonce for an ephemeral key; the client reveals PAN/CVC itself. */
	ephemeralKey: (i: { providerCardId: string; nonce: string }) => Fx<{ ephemeralKeySecret: string; expiresAt: number | null }>
	listTransactions: (i: { providerCardId: string; limit: number; startingAfter?: string | undefined }) => Fx<ProviderTransaction[]>
	/** Verify signature over the RAW body and normalize the event. */
	verifyWebhook: (rawBody: string, signatureHeader: string | undefined, nowSec?: number) => Fx<WebhookEvent>
	/** Out-of-band approve/decline via REST (fallback when the sync answer was missed). */
	approve: (providerAuthorizationId: string, amountMinor?: bigint) => Fx<void>
	decline: (providerAuthorizationId: string) => Fx<void>
	/** Build the synchronous webhook reply carrying the decision. */
	webhookResponse: (d: AuthorizationDecision) => WebhookHttpResponse
}
