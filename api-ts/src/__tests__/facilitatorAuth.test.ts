import { describe, expect, it } from 'bun:test'
import { resolveFacilitatorConfig } from '../services/FacilitatorService'

const DEFAULT_URL = 'https://x402.org/facilitator'
const CDP_URL = 'https://api.cdp.coinbase.com/platform/v2/x402'

describe('resolveFacilitatorConfig (CDP mainnet auth wiring)', () => {
	it('falls back to no auth when neither CDP creds nor a bearer token are set', () => {
		const cfg = resolveFacilitatorConfig({ X402_FACILITATOR_URL: DEFAULT_URL })
		expect(cfg.url).toBe(DEFAULT_URL)
		expect(cfg.createAuthHeaders).toBeUndefined()
	})

	it('uses a static bearer token when only X402_FACILITATOR_API_KEY is set', async () => {
		const cfg = resolveFacilitatorConfig({
			X402_FACILITATOR_URL: DEFAULT_URL,
			X402_FACILITATOR_API_KEY: 'test-token',
		})
		expect(cfg.url).toBe(DEFAULT_URL)
		expect(cfg.createAuthHeaders).toBeTypeOf('function')
		const headers = await cfg.createAuthHeaders?.()
		expect(headers?.verify).toEqual({ Authorization: 'Bearer test-token' })
		expect(headers?.settle).toEqual({ Authorization: 'Bearer test-token' })
		expect(headers?.supported).toEqual({ Authorization: 'Bearer test-token' })
	})

	it('selects CDP JWT auth when both CDP_API_KEY_ID and CDP_API_KEY_SECRET are set', () => {
		const cfg = resolveFacilitatorConfig({
			X402_FACILITATOR_URL: DEFAULT_URL,
			CDP_API_KEY_ID: 'test-key-id',
			CDP_API_KEY_SECRET: 'test-key-secret',
		})
		// Default (unmodified) X402_FACILITATOR_URL means CDP's hosted endpoint wins.
		expect(cfg.url).toBe(CDP_URL)
		expect(cfg.createAuthHeaders).toBeTypeOf('function')
	})

	it('prefers CDP JWT auth over a static bearer token when both are configured', () => {
		const cfg = resolveFacilitatorConfig({
			X402_FACILITATOR_URL: DEFAULT_URL,
			X402_FACILITATOR_API_KEY: 'test-token',
			CDP_API_KEY_ID: 'test-key-id',
			CDP_API_KEY_SECRET: 'test-key-secret',
		})
		expect(cfg.url).toBe(CDP_URL)
	})

	it('an explicit non-CDP X402_FACILITATOR_URL override wins on URL but gets NO CDP auth headers', () => {
		const customUrl = 'https://staging-facilitator.example.com'
		const cfg = resolveFacilitatorConfig({
			X402_FACILITATOR_URL: customUrl,
			CDP_API_KEY_ID: 'test-key-id',
			CDP_API_KEY_SECRET: 'test-key-secret',
		})
		// Operator explicitly pointed at a non-default facilitator (e.g. self-hosted
		// or testnet) — that must not be silently swapped for CDP's mainnet URL...
		expect(cfg.url).toBe(customUrl)
		// ...but a CDP-scoped JWT must NEVER be sent to a non-CDP host. Getting no
		// auth here (rather than leaking the CDP JWT to a third-party host) is the
		// safe outcome; the target facilitator will just reject/ignore no-auth.
		expect(cfg.createAuthHeaders).toBeUndefined()
	})

	it('does not select CDP auth when only one of the two CDP vars is set', () => {
		const cfg = resolveFacilitatorConfig({
			X402_FACILITATOR_URL: DEFAULT_URL,
			CDP_API_KEY_ID: 'test-key-id',
		})
		expect(cfg.url).toBe(DEFAULT_URL)
		expect(cfg.createAuthHeaders).toBeUndefined()
	})

	it('treats an empty-string X402_FACILITATOR_URL as unset, resolving to CDP’s URL + auth', () => {
		const cfg = resolveFacilitatorConfig({
			X402_FACILITATOR_URL: '',
			CDP_API_KEY_ID: 'test-key-id',
			CDP_API_KEY_SECRET: 'test-key-secret',
		})
		// Schema.optionalWith only defaults on an ABSENT key, so "" would otherwise
		// count as an "explicit override" to the empty string and fall through to
		// HTTPFacilitatorClient's own default (x402.org) while still carrying the
		// CDP JWT — that's the leak this test guards against.
		expect(cfg.url).toBe(CDP_URL)
		expect(cfg.createAuthHeaders).toBeTypeOf('function')
	})

	it('treats a whitespace-only X402_FACILITATOR_URL as unset too', () => {
		const cfg = resolveFacilitatorConfig({
			X402_FACILITATOR_URL: '   ',
			CDP_API_KEY_ID: 'test-key-id',
			CDP_API_KEY_SECRET: 'test-key-secret',
		})
		expect(cfg.url).toBe(CDP_URL)
		expect(cfg.createAuthHeaders).toBeTypeOf('function')
	})

	it('never throws on a malformed X402_FACILITATOR_URL override (falls back to no auth)', () => {
		expect(() =>
			resolveFacilitatorConfig({
				X402_FACILITATOR_URL: 'not a valid url ::: at all',
				CDP_API_KEY_ID: 'test-key-id',
				CDP_API_KEY_SECRET: 'test-key-secret',
			}),
		).not.toThrow()

		const cfg = resolveFacilitatorConfig({
			X402_FACILITATOR_URL: 'not a valid url ::: at all',
			CDP_API_KEY_ID: 'test-key-id',
			CDP_API_KEY_SECRET: 'test-key-secret',
		})
		expect(cfg.url).toBe('not a valid url ::: at all')
		expect(cfg.createAuthHeaders).toBeUndefined()
	})
})
