/**
 * Due (api.due.network) adapter. Live docs (docs.due.network) were unreachable from the build
 * environment on 2026-11-27; only `POST /v1/transfers/quote`, `POST /v1/transfers` and
 * `POST /v1/transfers/{id}/transfer_intent` were probed (all exist: 401 err_unauthorized without a key)
 * and the request/response shapes come from docs/plans/neobank-provider-apis.md.
 *
 * Implemented: quote only. NOT implemented (typed UNSUPPORTED): customers/KYC, virtual accounts,
 * external accounts, createOfframp (needs transfer_intent EIP-712 signables signed by Turnkey
 * typed-data, not wired), getTransfer, webhooks. Rails served = operator-declared DUE_ENABLED_RAILS
 * (PIX/SPEI destination support is UNVERIFIED in the plan, so nothing is assumed).
 */
import { isRail, type Rail } from './rails'
import {
	type ProviderCaps,
	type ProviderTransfer,
	RampError,
	type RampProvider,
	type RampQuote,
	type RampQuoteRequest,
	unsupported,
} from './RampProvider'

export interface DueConfig {
	apiKey: string | undefined
	accountId: string | undefined
	baseUrl: string
	enabledRails: string | undefined
}

export class DueProvider implements RampProvider {
	readonly id = 'due' as const
	constructor(private readonly cfg: DueConfig) {}

	missingConfig(): string | null {
		if (!this.cfg.apiKey) return 'DUE_API_KEY'
		if (!this.cfg.accountId) return 'DUE_ACCOUNT_ID'
		return null
	}

	capabilities(): ProviderCaps {
		const rails = (this.cfg.enabledRails ?? '')
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(isRail) as Rail[]
		return { source: rails, destination: rails, currencies: [] }
	}

	private async quote(q: RampQuoteRequest, direction: 'off' | 'on'): Promise<RampQuote> {
		const missing = this.missingConfig()
		if (missing) throw new RampError('PROVIDER_NOT_CONFIGURED', missing, { missing })
		const caps = this.capabilities()
		const rail = direction === 'off' ? q.destRail : q.sourceRail
		if (rail === 'crypto' || !(direction === 'off' ? caps.destination : caps.source).includes(rail)) {
			throw new RampError('RAIL_NO_PROVIDER', `Due is not enabled for rail ${rail} (set DUE_ENABLED_RAILS after onboarding)`)
		}
		const amount = (Number(q.amountMinor) / 10 ** q.sourceDecimals).toFixed(q.sourceDecimals)
		let res: Response
		try {
			res = await fetch(`${this.cfg.baseUrl}/transfers/quote`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Due-Account-Id': this.cfg.accountId as string, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					source: { rail: q.sourceRail === 'crypto' ? q.sourceCurrency.toLowerCase() : q.sourceRail, currency: q.sourceCurrency, amount },
					destination: { rail: q.destRail === 'crypto' ? q.destCurrency.toLowerCase() : q.destRail, currency: q.destCurrency },
				}),
				signal: AbortSignal.timeout(30_000),
			})
		} catch (e) {
			throw new RampError('UPSTREAM', `Due unreachable: ${String(e)}`)
		}
		const body = (await res.json().catch(() => ({}))) as Record<string, any>
		if (res.status === 401) throw new RampError('AUTH', `Due rejected credentials: ${body.message ?? ''}`, { missing: 'DUE_API_KEY (valid)', status: 401, body })
		if (!res.ok) throw new RampError(res.status < 500 ? 'VALIDATION' : 'UPSTREAM', `Due ${res.status}: ${body.message ?? JSON.stringify(body).slice(0, 200)}`, { status: res.status, body })
		const destAmt = body.destination?.amount ?? body.destinationAmount
		if (!body.token || destAmt == null || body.fxRate == null) {
			throw new RampError('UPSTREAM', 'Due quote response missing token/destination.amount/fxRate (shape unconfirmed)', { body })
		}
		const [i = '0', f = ''] = String(destAmt).split('.')
		const receive = BigInt(i + f.slice(0, q.destDecimals).padEnd(q.destDecimals, '0')).toString()
		return {
			provider: 'due',
			quoteId: String(body.token),
			expiresAt: body.expiresAt ? String(body.expiresAt) : null,
			sourceCurrency: q.sourceCurrency,
			destCurrency: q.destCurrency,
			sendAmountMinor: q.amountMinor,
			receiveAmountMinor: receive,
			feeMinor: null,
			rate: String(body.fxRate),
			etaSeconds: null,
			indicative: false,
			route: ['due', `${q.sourceRail}->${q.destRail}`],
		}
	}

	quoteOfframp(q: RampQuoteRequest) {
		return this.quote(q, 'off')
	}
	quoteOnramp(q: RampQuoteRequest) {
		return this.quote(q, 'on')
	}
	createCustomer() {
		return Promise.resolve(unsupported('due', 'customers'))
	}
	kycLink() {
		return Promise.resolve(unsupported('due', 'kyc'))
	}
	kycStatus() {
		return Promise.resolve(unsupported('due', 'kyc status'))
	}
	createVirtualAccount() {
		return Promise.resolve(unsupported('due', 'virtual accounts'))
	}
	registerExternalAccount() {
		return Promise.resolve(unsupported('due', 'external accounts'))
	}
	createOfframp(): Promise<ProviderTransfer> {
		return Promise.reject(new RampError('UNSUPPORTED', 'Due transfer requires signing the transfer_intent EIP-712 payload (typed-data signing not wired in api-ts)'))
	}
	getTransfer(): Promise<ProviderTransfer> {
		return Promise.reject(new RampError('UNSUPPORTED', 'Due GET transfer path not confirmed'))
	}
	verifyWebhook(): void {
		throw new RampError('UNSUPPORTED', 'Due webhook signature scheme not confirmed')
	}
	parseWebhook(): never {
		throw new RampError('UNSUPPORTED', 'Due webhook format not confirmed')
	}
}
