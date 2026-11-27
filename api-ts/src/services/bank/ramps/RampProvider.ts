/** Ramp provider contract. Providers do HTTP only; persistence + ledger live in BankRampService. */
import type { Rail } from './rails'

export type ProviderId = 'bridge' | 'due'

export type RampErrorCode =
	| 'PROVIDER_NOT_CONFIGURED'
	| 'RAIL_NO_PROVIDER'
	| 'UNSUPPORTED'
	| 'AML_REJECTED'
	| 'AUTH'
	| 'CONFLICT'
	| 'VALIDATION'
	| 'UPSTREAM'
	| 'SIGNATURE'

/** Typed provider failure. `missing` names the exact absent input (env var / onboarding step). */
export class RampError extends Error {
	constructor(
		readonly code: RampErrorCode,
		message: string,
		readonly extra: { missing?: string; status?: number; body?: unknown } = {},
	) {
		super(`${code}: ${message}`)
		this.name = 'RampError'
	}
}

export interface ProviderCaps {
	/** Rails money can arrive from (onramp / virtual-account deposits). */
	source: Rail[]
	/** Rails money can be paid out to (offramp). */
	destination: Rail[]
	currencies: string[]
}

export interface RampKycInput {
	email: string
	fullName: string
	type: 'individual' | 'business'
	idempotencyKey: string
}
export interface RampKycResult {
	providerCustomerId: string
	kycLinkId: string
	kycLink: string | null
	tosLink: string | null
	kycStatus: string
	tosStatus: string | null
}

export interface RampQuoteRequest {
	sourceRail: Rail | 'crypto'
	sourceCurrency: string // fiat ISO or stablecoin symbol, upper-case
	destRail: Rail | 'crypto'
	destCurrency: string
	/** Source amount in minor units of sourceCurrency (fiat: FIAT_DECIMALS; stablecoin: asset decimals). */
	amountMinor: string
	sourceDecimals: number
	destDecimals: number
}

export interface RampQuote {
	provider: ProviderId
	quoteId: string | null
	expiresAt: string | null
	sourceCurrency: string
	destCurrency: string
	sendAmountMinor: string
	/** Net the recipient receives after fees + fx. */
	receiveAmountMinor: string
	/** Total fee in source minor units (fx spread + provider fee) when derivable, else null. */
	feeMinor: string | null
	/** Units of dest per 1 source (provider rate incl. fee when the provider only reports that). */
	rate: string
	etaSeconds: number | null
	/** true = indicative (provider offers no locked quote). */
	indicative: boolean
	route: string[]
}

export interface VirtualAccountInput {
	providerCustomerId: string
	sourceCurrency: string // usd | eur | mxn | brl | cop | gbp
	destCurrency: string // stablecoin symbol
	destRail: string // chain key per provider naming
	destAddress: string
	idempotencyKey: string
}
export interface VirtualAccountResult {
	providerId: string
	status: string
	/** Deposit instructions as returned (ACH/wire/SEPA/SPEI/PIX br_code, ...). */
	instructions: Record<string, unknown>
}

export interface ExternalAccountInput {
	providerCustomerId: string
	accountType: 'us' | 'iban' | 'clabe'
	ownerName: string
	bankName?: string
	/** us: account_number+routing_number; iban: account_number(+bic,country); clabe: account_number. */
	account: Record<string, string>
	address?: { street_line_1: string; city: string; country: string; state?: string; postal_code?: string }
	idempotencyKey: string
}
export interface ExternalAccountResult {
	providerId: string
	rail: Rail
	currency: string
	details: Record<string, unknown>
}

export interface OfframpInput {
	providerCustomerId: string
	externalAccountId: string
	destRail: Rail
	destCurrency: string
	sourceChainRail: string // provider chain naming (base, ethereum, polygon, solana ...)
	sourceCurrency: string // stablecoin lower-case per provider
	fromAddress: string
	amountDecimal: string
	clientReferenceId: string
	idempotencyKey: string
	reference?: string
}
export interface ProviderTransfer {
	providerId: string
	state: string
	/** Where to send the stablecoin (offramp) when the provider supplies a deposit address. */
	depositAddress: string | null
	depositAmountDecimal: string | null
	receiveAmountDecimal: string | null
	feeDecimal: string | null
	raw: Record<string, unknown>
}

export interface ParsedWebhook {
	eventId: string
	category: string
	type: string
	objectId: string
	/** Normalised object for the service to act on. */
	object: Record<string, unknown>
}

export interface RampProvider {
	readonly id: ProviderId
	/** Returns the missing env var name, or null when usable. */
	missingConfig(): string | null
	capabilities(): ProviderCaps
	createCustomer(i: RampKycInput): Promise<RampKycResult>
	kycLink(i: RampKycInput): Promise<RampKycResult>
	kycStatus(kycLinkId: string): Promise<{ kycStatus: string; tosStatus: string | null; providerCustomerId: string }>
	createVirtualAccount(i: VirtualAccountInput): Promise<VirtualAccountResult>
	quoteOfframp(q: RampQuoteRequest): Promise<RampQuote>
	quoteOnramp(q: RampQuoteRequest): Promise<RampQuote>
	registerExternalAccount(i: ExternalAccountInput): Promise<ExternalAccountResult>
	createOfframp(i: OfframpInput): Promise<ProviderTransfer>
	getTransfer(providerId: string): Promise<ProviderTransfer>
	/** Throws RampError('SIGNATURE') when invalid. */
	verifyWebhook(headers: Record<string, string | undefined>, rawBody: string): void
	parseWebhook(rawBody: string): ParsedWebhook
}

export const unsupported = (provider: string, what: string): never => {
	throw new RampError('UNSUPPORTED', `${provider} adapter does not implement ${what} (not confirmed against provider docs)`)
}
