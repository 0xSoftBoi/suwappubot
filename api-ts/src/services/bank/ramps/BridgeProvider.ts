/**
 * Bridge (bridge.xyz) adapter. Every path/field below was confirmed against the live OpenAPI
 * (apidocs.bridge.xyz *.md pages) on 2026-11-27. Deliberately NOT implemented (unconfirmed or
 * contradictory in docs): PIX payout (example exists but the destination rail enum omits `pix`),
 * swift / bre_b external accounts, POST /customers (KYC link creates the customer),
 * liquidation addresses, sandbox base URL.
 *
 * MONEY-PATH: createOfframp starts a fiat payout; the caller must then move the stablecoin
 * to depositAddress through BankTransferService (never sign here).
 */
import { createHash, createPublicKey, randomUUID, verify as cryptoVerify } from 'node:crypto'
import { FIAT_DECIMALS, type Rail } from './rails'
import {
	type ExternalAccountInput,
	type ExternalAccountResult,
	type OfframpInput,
	type ParsedWebhook,
	type ProviderCaps,
	type ProviderTransfer,
	RampError,
	type RampKycInput,
	type RampKycResult,
	type RampProvider,
	type RampQuote,
	type RampQuoteRequest,
	type VirtualAccountInput,
	type VirtualAccountResult,
} from './RampProvider'

export interface BridgeConfig {
	apiKey: string | undefined
	baseUrl: string
	webhookPublicKey: string | undefined
}

const BRIDGE_RATE_PAIRS = new Set(['brl', 'cop', 'eur', 'gbp', 'mxn', 'ngn'])
const STABLE_AS_USD = new Set(['USDC', 'USDT', 'USD', 'PYUSD', 'USDB'])
const WEBHOOK_MAX_AGE_MS = 10 * 60_000

/** Decimal-string rate * minor amount -> dest minor (floor), integer math only. */
export function applyRate(minor: string, rate: string, srcDec: number, dstDec: number): string {
	if (!/^\d+(\.\d+)?$/.test(rate)) throw new RampError('UPSTREAM', `non-numeric rate ${rate}`)
	const [ri = '0', rf = ''] = rate.split('.')
	const scale = rf.length
	const num = BigInt(ri + rf)
	return ((BigInt(minor) * num * 10n ** BigInt(dstDec)) / (10n ** BigInt(scale) * 10n ** BigInt(srcDec))).toString()
}

const decToMinor = (dec: string, decimals: number): string => {
	const [i = '0', f = ''] = dec.split('.')
	return BigInt(i + f.slice(0, decimals).padEnd(decimals, '0')).toString()
}

export class BridgeProvider implements RampProvider {
	readonly id = 'bridge' as const
	constructor(private readonly cfg: BridgeConfig) {}

	missingConfig(): string | null {
		return this.cfg.apiKey ? null : 'BRIDGE_API_KEY'
	}

	capabilities(): ProviderCaps {
		return {
			// virtual-account / transfer source deposit rails (live doc OnrampSourceDepositPaymentRail)
			source: ['ach', 'wire', 'fednow', 'sepa', 'spei', 'pix', 'bre_b'],
			// external-account types we can register (us, iban, clabe) -> ach/wire/fednow, sepa, spei
			destination: ['ach', 'wire', 'fednow', 'sepa', 'spei'],
			currencies: ['USD', 'EUR', 'MXN', 'BRL', 'COP', 'GBP'],
		}
	}

	// ------------------------------------------------------------ http
	private async call(method: 'GET' | 'POST', path: string, body?: unknown, idemKey?: string): Promise<Record<string, any>> {
		const missing = this.missingConfig()
		if (missing) throw new RampError('PROVIDER_NOT_CONFIGURED', missing, { missing })
		const key = method === 'POST' ? (idemKey ?? randomUUID()) : undefined
		let last: RampError | null = null
		for (let attempt = 0; attempt < 4; attempt++) {
			let res: Response
			try {
				res = await fetch(`${this.cfg.baseUrl}${path}`, {
					method,
					headers: {
						'Api-Key': this.cfg.apiKey as string,
						Accept: 'application/json',
						...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
						...(key ? { 'Idempotency-Key': key } : {}),
					},
					...(body !== undefined ? { body: JSON.stringify(body) } : {}),
					signal: AbortSignal.timeout(30_000),
				})
			} catch (e) {
				throw new RampError('UPSTREAM', `Bridge unreachable: ${String(e)}`)
			}
			const text = await res.text()
			let json: Record<string, any> = {}
			try {
				json = text ? JSON.parse(text) : {}
			} catch {
				/* non-JSON error body */
			}
			if (res.ok) return json
			last = mapBridgeError(res.status, json, text)
			// 409 resource_state_conflict is transient: retry with the SAME idempotency key.
			if (res.status === 409 && attempt < 3) {
				await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
				continue
			}
			throw last
		}
		throw last ?? new RampError('UPSTREAM', 'Bridge request failed')
	}

	// ------------------------------------------------------------ kyc
	async createCustomer(i: RampKycInput): Promise<RampKycResult> {
		// POST /kyc_links creates the customer and returns hosted KYC + TOS links.
		const r = await this.call('POST', '/kyc_links', { full_name: i.fullName, email: i.email, type: i.type }, i.idempotencyKey)
		return kycResult(r)
	}
	kycLink(i: RampKycInput): Promise<RampKycResult> {
		return this.createCustomer(i)
	}
	async kycStatus(kycLinkId: string) {
		const r = await this.call('GET', `/kyc_links/${encodeURIComponent(kycLinkId)}`)
		return { kycStatus: String(r.kyc_status ?? 'unknown'), tosStatus: r.tos_status ? String(r.tos_status) : null, providerCustomerId: String(r.customer_id ?? '') }
	}

	// ------------------------------------------------------------ virtual accounts
	async createVirtualAccount(i: VirtualAccountInput): Promise<VirtualAccountResult> {
		const r = await this.call(
			'POST',
			`/customers/${encodeURIComponent(i.providerCustomerId)}/virtual_accounts`,
			{
				source: { currency: i.sourceCurrency.toLowerCase() },
				destination: { currency: i.destCurrency.toLowerCase(), payment_rail: i.destRail, address: i.destAddress },
			},
			i.idempotencyKey,
		)
		if (!r.id) throw new RampError('UPSTREAM', 'Bridge virtual account response missing id', { body: r })
		return { providerId: String(r.id), status: String(r.status ?? 'activated'), instructions: (r.source_deposit_instructions ?? {}) as Record<string, unknown> }
	}

	// ------------------------------------------------------------ quotes (indicative: Bridge has no locked quote)
	private async rate(from: string, to: string): Promise<{ rate: string; mid: string }> {
		const r = await this.call('GET', `/exchange_rates?from=${from}&to=${to}`)
		const buy = String(r.buy_rate ?? '')
		const sell = String(r.sell_rate ?? '')
		if (!buy || !sell || !r.midmarket_rate) throw new RampError('UPSTREAM', 'Bridge exchange_rates response missing rates', { body: r })
		// both rates include Bridge's fee; the user-conservative one is the lower.
		return { rate: Number(buy) <= Number(sell) ? buy : sell, mid: String(r.midmarket_rate) }
	}

	private async quote(q: RampQuoteRequest, fiat: string, direction: 'off' | 'on'): Promise<RampQuote> {
		const fiatLc = fiat.toLowerCase()
		let rate = '1'
		let mid = '1'
		if (fiatLc !== 'usd') {
			if (!BRIDGE_RATE_PAIRS.has(fiatLc)) throw new RampError('RAIL_NO_PROVIDER', `Bridge has no USD<>${fiat.toUpperCase()} rate`)
			const rr = direction === 'off' ? await this.rate('usd', fiatLc) : await this.rate(fiatLc, 'usd')
			rate = rr.rate
			mid = rr.mid
		}
		const receive = applyRate(q.amountMinor, rate, q.sourceDecimals, q.destDecimals)
		const midReceive = applyRate(q.amountMinor, mid, q.sourceDecimals, q.destDecimals)
		// fee in source minor = (midReceive - receive) converted back at mid (only when we have a mid)
		let fee: string | null = null
		if (fiatLc !== 'usd' && BigInt(midReceive) > 0n) {
			fee = ((BigInt(q.amountMinor) * (BigInt(midReceive) - BigInt(receive))) / BigInt(midReceive)).toString()
		}
		return {
			provider: 'bridge',
			quoteId: null,
			expiresAt: null,
			sourceCurrency: q.sourceCurrency,
			destCurrency: q.destCurrency,
			sendAmountMinor: q.amountMinor,
			receiveAmountMinor: receive,
			feeMinor: fee,
			rate,
			etaSeconds: null,
			indicative: true,
			route: ['bridge', direction === 'off' ? `${q.sourceCurrency}->${q.destRail}` : `${q.sourceRail}->${q.destCurrency}`],
		}
	}

	async quoteOfframp(q: RampQuoteRequest): Promise<RampQuote> {
		if (!STABLE_AS_USD.has(q.sourceCurrency)) throw new RampError('RAIL_NO_PROVIDER', `Bridge offramp source ${q.sourceCurrency} not supported (USD stablecoins only)`)
		if (q.destRail === 'crypto' || !this.capabilities().destination.includes(q.destRail)) {
			throw new RampError('RAIL_NO_PROVIDER', `Bridge cannot pay out on rail ${q.destRail}`)
		}
		return this.quote(q, q.destCurrency, 'off')
	}
	async quoteOnramp(q: RampQuoteRequest): Promise<RampQuote> {
		if (q.sourceRail === 'crypto' || !this.capabilities().source.includes(q.sourceRail)) {
			throw new RampError('RAIL_NO_PROVIDER', `Bridge cannot accept deposits on rail ${q.sourceRail}`)
		}
		if (!STABLE_AS_USD.has(q.destCurrency)) throw new RampError('RAIL_NO_PROVIDER', `Bridge onramp destination ${q.destCurrency} not supported (USD stablecoins only)`)
		return this.quote(q, q.sourceCurrency, 'on')
	}

	// ------------------------------------------------------------ external accounts
	async registerExternalAccount(i: ExternalAccountInput): Promise<ExternalAccountResult> {
		const base: Record<string, unknown> = { account_owner_name: i.ownerName, ...(i.bankName ? { bank_name: i.bankName } : {}), ...(i.address ? { address: i.address } : {}) }
		let body: Record<string, unknown>
		let rail: Rail
		let currency: string
		if (i.accountType === 'us') {
			if (!i.account.account_number || !i.account.routing_number) throw new RampError('VALIDATION', 'us account needs account_number and routing_number')
			if (!i.address) throw new RampError('VALIDATION', 'us accounts require address (street_line_1, city, country)')
			body = { ...base, account_type: 'us', currency: 'usd', account: { account_number: i.account.account_number, routing_number: i.account.routing_number } }
			rail = 'ach'
			currency = 'USD'
		} else if (i.accountType === 'iban') {
			if (!i.account.account_number || !i.account.country) throw new RampError('VALIDATION', 'iban account needs account_number and country (alpha-3)')
			body = { ...base, account_type: 'iban', currency: 'eur', iban: { account_number: i.account.account_number, country: i.account.country, ...(i.account.bic ? { bic: i.account.bic } : {}) } }
			rail = 'sepa'
			currency = 'EUR'
		} else {
			if (!i.account.account_number || i.account.account_number.length !== 18) throw new RampError('VALIDATION', 'clabe account_number must be 18 digits')
			body = { ...base, account_type: 'clabe', currency: 'mxn', clabe: { account_number: i.account.account_number } }
			rail = 'spei'
			currency = 'MXN'
		}
		const r = await this.call('POST', `/customers/${encodeURIComponent(i.providerCustomerId)}/external_accounts`, body, i.idempotencyKey)
		if (!r.id) throw new RampError('UPSTREAM', 'Bridge external account response missing id', { body: r })
		const last4 = i.account.account_number?.slice(-4)
		return { providerId: String(r.id), rail, currency, details: { last4, ownerName: i.ownerName, bankName: i.bankName ?? null, accountType: i.accountType } }
	}

	// ------------------------------------------------------------ transfers
	async createOfframp(i: OfframpInput): Promise<ProviderTransfer> {
		if (!this.capabilities().destination.includes(i.destRail)) throw new RampError('RAIL_NO_PROVIDER', `Bridge cannot pay out on rail ${i.destRail}`)
		const r = await this.call(
			'POST',
			'/transfers',
			{
				on_behalf_of: i.providerCustomerId,
				client_reference_id: i.clientReferenceId,
				amount: i.amountDecimal,
				source: { payment_rail: i.sourceChainRail, currency: i.sourceCurrency, from_address: i.fromAddress },
				destination: { payment_rail: i.destRail, currency: i.destCurrency.toLowerCase(), external_account_id: i.externalAccountId },
			},
			i.idempotencyKey,
		)
		return toTransfer(r)
	}

	async getTransfer(providerId: string): Promise<ProviderTransfer> {
		return toTransfer(await this.call('GET', `/transfers/${encodeURIComponent(providerId)}`))
	}

	// ------------------------------------------------------------ webhooks
	verifyWebhook(headers: Record<string, string | undefined>, rawBody: string): void {
		const pem = this.cfg.webhookPublicKey
		if (!pem) throw new RampError('PROVIDER_NOT_CONFIGURED', 'BRIDGE_WEBHOOK_PUBLIC_KEY', { missing: 'BRIDGE_WEBHOOK_PUBLIC_KEY' })
		verifyBridgeSignature(headers['x-webhook-signature'], rawBody, pem, Date.now())
	}

	parseWebhook(rawBody: string): ParsedWebhook {
		let e: Record<string, any>
		try {
			e = JSON.parse(rawBody)
		} catch {
			throw new RampError('VALIDATION', 'webhook body is not JSON')
		}
		if (!e.event_id || !e.event_category || !e.event_type) throw new RampError('VALIDATION', 'webhook missing event_id/event_category/event_type')
		return { eventId: String(e.event_id), category: String(e.event_category), type: String(e.event_type), objectId: String(e.event_object_id ?? e.event_object?.id ?? ''), object: (e.event_object ?? {}) as Record<string, unknown> }
	}
}

/** Bridge signs SHA256(SHA256("{t}.{rawBody}")) with RSA PKCS#1 v1.5; verify() re-hashes, so pass the digest. */
export function verifyBridgeSignature(header: string | undefined, rawBody: string, publicKeyPem: string, nowMs: number): void {
	if (!header) throw new RampError('SIGNATURE', 'missing X-Webhook-Signature')
	const parts = Object.fromEntries(header.split(',').map((p) => { const k = p.indexOf('='); return [p.slice(0, k).trim(), p.slice(k + 1).trim()] }))
	const t = parts.t
	const sig = parts.v0
	if (!t || !sig || !/^\d+$/.test(t)) throw new RampError('SIGNATURE', 'malformed X-Webhook-Signature')
	if (nowMs - Number(t) > WEBHOOK_MAX_AGE_MS) throw new RampError('SIGNATURE', 'timestamp older than 10 minutes')
	if (Number(t) - nowMs > 60_000) throw new RampError('SIGNATURE', 'timestamp in the future')
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sig)) throw new RampError('SIGNATURE', 'signature is not strict base64')
	const digest = createHash('sha256').update(`${t}.${rawBody}`).digest()
	let ok = false
	try {
		ok = cryptoVerify('sha256', digest, createPublicKey(publicKeyPem), Buffer.from(sig, 'base64'))
	} catch (e) {
		throw new RampError('SIGNATURE', `verification error: ${String(e)}`)
	}
	if (!ok) throw new RampError('SIGNATURE', 'signature mismatch')
}

function kycResult(r: Record<string, any>): RampKycResult {
	if (!r.id || !r.customer_id) throw new RampError('UPSTREAM', 'Bridge kyc_links response missing id/customer_id', { body: r })
	return {
		providerCustomerId: String(r.customer_id),
		kycLinkId: String(r.id),
		kycLink: r.kyc_link ? String(r.kyc_link) : null,
		tosLink: r.tos_link ? String(r.tos_link) : null,
		kycStatus: String(r.kyc_status ?? 'not_started'),
		tosStatus: r.tos_status ? String(r.tos_status) : null,
	}
}

function toTransfer(r: Record<string, any>): ProviderTransfer {
	if (!r.id || !r.state) throw new RampError('UPSTREAM', 'Bridge transfer response missing id/state', { body: r })
	const dep = r.source_deposit_instructions ?? {}
	const rc = r.receipt ?? {}
	let fee: string | null = null
	if (rc.initial_amount != null && rc.final_amount != null) {
		const d = Math.max(String(rc.initial_amount).split('.')[1]?.length ?? 0, String(rc.final_amount).split('.')[1]?.length ?? 0, 2)
		const diff = BigInt(decToMinor(String(rc.initial_amount), d)) - BigInt(decToMinor(String(rc.final_amount), d))
		fee = (Number(diff) / 10 ** d).toFixed(d)
	}
	return {
		providerId: String(r.id),
		state: String(r.state),
		depositAddress: dep.to_address ? String(dep.to_address) : null,
		depositAmountDecimal: dep.amount != null ? String(dep.amount) : r.amount != null ? String(r.amount) : null,
		receiveAmountDecimal: rc.final_amount != null ? String(rc.final_amount) : null,
		feeDecimal: fee,
		raw: r,
	}
}

function mapBridgeError(status: number, json: Record<string, any>, text: string): RampError {
	const msg = String(json.message ?? json.error ?? text.slice(0, 200) ?? `HTTP ${status}`)
	const code = json.code ? ` [${json.code}]` : ''
	const extra = { status, body: json }
	if (status === 401) return new RampError('AUTH', `Bridge rejected credentials${code}: ${msg}`, { ...extra, missing: 'BRIDGE_API_KEY (valid)' })
	if (status === 403) return new RampError('AML_REJECTED', `Bridge compliance/AML rejection${code}: ${msg}`, extra)
	if (status === 409) return new RampError('CONFLICT', `Bridge state conflict${code}: ${msg}`, extra)
	if (status === 400 || status === 422 || status === 404) return new RampError('VALIDATION', `Bridge ${status}${code}: ${msg}`, extra)
	return new RampError('UPSTREAM', `Bridge ${status}${code}: ${msg}`, extra)
}

export const bridgeFiatDecimals = (c: string): number => FIAT_DECIMALS[c.toUpperCase()] ?? 2
