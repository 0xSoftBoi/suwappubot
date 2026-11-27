/**
 * Rain card adapter (M6). Rain's docs are gated, so ONLY the two endpoints listed in
 * docs/plans/neobank-provider-apis.md are wired (and those are marked UNVERIFIED there:
 * POST /issuing/applications/user, POST /issuing/users/{userId}/cards, header `Api-Key`).
 * Everything else returns typed PROVIDER_DOCS_REQUIRED. No endpoints are invented.
 */
import { Effect } from 'effect'
import { type BankError, bankErr } from '../errors'
import type { CardProvider, Fx } from './CardProvider'

export interface RainConfig {
	apiKey: string | undefined
	baseUrl: string | undefined
}

const DEFAULT_BASE = 'https://api-dev.raincards.xyz/v1'

const docsRequired = (op: string): Fx<never> =>
	Effect.fail(
		bankErr('NOT_CONFIGURED', `PROVIDER_DOCS_REQUIRED: Rain ${op} endpoint is not in the available docs (gated). Obtain Rain API docs to implement it.`, {
			missing: `RAIN_DOCS:${op}`,
		}),
	)

const call = (cfg: RainConfig, path: string, body: unknown): Effect.Effect<Record<string, unknown>, BankError> =>
	Effect.gen(function* () {
		if (!cfg.apiKey)
			return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'PROVIDER_NOT_CONFIGURED: RAIN_API_KEY', { missing: 'RAIN_API_KEY' }))
		const base = (cfg.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '')
		const res = yield* Effect.tryPromise({
			try: () =>
				fetch(`${base}${path}`, {
					method: 'POST',
					headers: { 'Api-Key': cfg.apiKey!, 'Content-Type': 'application/json', Accept: 'application/json' },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(15_000),
				}),
			catch: (e) => bankErr('UPSTREAM', `Rain request failed: ${String(e)}`, { cause: e }),
		})
		const text = yield* Effect.tryPromise({ try: () => res.text(), catch: (e) => bankErr('UPSTREAM', `Rain response unreadable: ${String(e)}`) })
		if (!res.ok) return yield* Effect.fail(bankErr('UPSTREAM', `Rain ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`))
		try {
			return JSON.parse(text) as Record<string, unknown>
		} catch {
			return yield* Effect.fail(bankErr('UPSTREAM', `Rain ${path} returned non-JSON`))
		}
	})

const pickId = (o: Record<string, unknown>, what: string): Fx<string> => {
	const id = o.id ?? o.userId
	return typeof id === 'string' && id
		? Effect.succeed(id)
		: Effect.fail(bankErr('UPSTREAM', `Rain ${what} response had no id (response shape is UNVERIFIED)`))
}

export function makeRainProvider(cfg: RainConfig): CardProvider {
	return {
		name: 'rain',
		createCardholder: (i) =>
			Effect.gen(function* () {
				const r = yield* call(cfg, '/issuing/applications/user', {
					firstName: i.individual?.firstName,
					lastName: i.individual?.lastName,
					email: i.email,
					phoneNumber: i.phoneNumber,
					birthDate: i.individual ? `${i.individual.dob.year}-${String(i.individual.dob.month).padStart(2, '0')}-${String(i.individual.dob.day).padStart(2, '0')}` : undefined,
					address: i.billing,
				})
				return { providerCardholderId: yield* pickId(r, 'application') }
			}),
		issueCard: (i) =>
			Effect.gen(function* () {
				if (i.type === 'physical') return yield* docsRequired('physical card issuance')
				const r = yield* call(cfg, `/issuing/users/${encodeURIComponent(i.providerCardholderId)}/cards`, { type: i.type })
				const last4 = typeof r.last4 === 'string' ? r.last4 : null
				return {
					providerCardId: yield* pickId(r, 'card'),
					status: 'active' as const,
					brand: null,
					last4,
					expMonth: null,
					expYear: null,
				}
			}),
		setStatus: () => docsRequired('card status update'),
		updateSpendingControls: () => docsRequired('spending controls'),
		ephemeralKey: () => docsRequired('card reveal / ephemeral key'),
		listTransactions: () => docsRequired('transactions list'),
		verifyWebhook: () => docsRequired('webhook signature verification'),
		approve: () => docsRequired('authorization approve'),
		decline: () => docsRequired('authorization decline'),
		webhookResponse: () => ({ status: 501, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'PROVIDER_DOCS_REQUIRED', provider: 'rain' }) }),
	}
}
