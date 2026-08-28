import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { bearerSessionSource, trustedSpendDecision, trustedSpendPreflight } from '../middleware/trustedSpend'

function unsignedJwt(src?: string): string {
	const encode = (value: object) =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
	return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: 123, ...(src ? { src } : {}) })}.signature`
}

describe('trusted spend preflight', () => {
	it('recognizes only the bearer provenance tag; downstream auth still verifies the signature', () => {
		expect(bearerSessionSource(`Bearer ${unsignedJwt('siwe')}`)).toBe('siwe')
		expect(bearerSessionSource(`Bearer ${unsignedJwt('weak')}`)).toBe('weak')
		expect(bearerSessionSource(`Bearer ${unsignedJwt()}`)).toBeNull()
		expect(bearerSessionSource('Bearer malformed')).toBeNull()
	})

	it('accepts strong trading bearers and rejects weak/legacy bearer tokens', () => {
		for (const src of ['siwe', 'telegram', 'passkey']) {
			const request = new Request('https://api.suwappu.bot/public/swap/execute', {
				method: 'POST',
				headers: { Authorization: `Bearer ${unsignedJwt(src)}` },
			})
			expect(trustedSpendDecision(request)).toEqual({ ok: true, via: 'strong_bearer' })
		}

		for (const src of ['weak', 'oauth', undefined]) {
			const request = new Request('https://api.suwappu.bot/public/swap/execute', {
				method: 'POST',
				headers: { Authorization: `Bearer ${unsignedJwt(src)}` },
			})
			expect(trustedSpendDecision(request)).toEqual({ ok: false, reason: 'weak_bearer' })
		}
	})

	it('accepts a server cookie only from explicit first-party browser origins', () => {
		const trusted = new Request('https://api.suwappu.bot/public/swap/execute', {
			method: 'POST',
			headers: {
				Cookie: 'other=x; suwappu_auth=server-session; theme=dark',
				Origin: 'https://terminal.suwappu.bot',
			},
		})
		expect(trustedSpendDecision(trusted)).toEqual({ ok: true, via: 'first_party_cookie' })

		const crossSite = new Request('https://api.suwappu.bot/public/swap/execute', {
			method: 'POST',
			headers: { Cookie: 'suwappu_auth=server-session', Origin: 'https://evil.example' },
		})
		expect(trustedSpendDecision(crossSite)).toEqual({ ok: false, reason: 'untrusted_cookie_origin' })
	})

	it('does not let a weak bearer hide behind a good cookie because downstream prefers Authorization', () => {
		const request = new Request('https://api.suwappu.bot/public/swap/execute', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${unsignedJwt('weak')}`,
				Cookie: 'suwappu_auth=server-session',
				Origin: 'https://terminal.suwappu.bot',
			},
		})
		expect(trustedSpendDecision(request)).toEqual({ ok: false, reason: 'weak_bearer' })
	})

	it('returns a stable 403 contract before a spend route runs', async () => {
		const app = new Hono()
		app.use('/execute', trustedSpendPreflight())
		app.post('/execute', (c) => c.json({ signed: true }))

		const denied = await app.request('/execute', {
			method: 'POST',
			headers: { Authorization: `Bearer ${unsignedJwt('weak')}` },
		})
		expect(denied.status).toBe(403)
		expect(await denied.json()).toMatchObject({ code: 'TRADING_PROOF_REQUIRED' })
	})
})
