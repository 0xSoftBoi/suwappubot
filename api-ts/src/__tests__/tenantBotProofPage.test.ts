import { describe, expect, it } from 'bun:test'
import {
	esc,
	type ProofPageData,
	renderProofPage,
	safeUrl,
} from '../services/tenantBots/proofPage'

/**
 * The proof page is the first HTML surface in api-ts, it is PUBLIC, and it
 * renders strings a tenant controls — bot name, funding note, refusal reasons.
 * That is a stored-XSS surface aimed at precisely the holders the page exists
 * to protect, so the escaping is tested rather than trusted.
 *
 * The second group of tests is about honesty rather than security: the page
 * must not become readable by quietly dropping the parts that make it proof.
 */

const XSS = '<script>alert(1)</script>'
const ATTR = '" onload="alert(1)'

function data(over: Partial<ProofPageData> = {}): ProofPageData {
	return {
		bot: {
			name: 'PEPE Burn Bot',
			handle: 'pepeburnbot',
			token_symbol: 'PEPE',
			token_chain: 'base',
			token_address: '0xToken',
			treasury_address: '0xTreasury',
			status: 'live',
		},
		funding: { source: 'revenue', note: '0.8% of swap fees' },
		headline: '$100 of PEPE sent to a burn address across 2 runs',
		totals: {
			executed_runs: 2,
			executed_spend_usd: 100,
			simulated_runs: 1,
			skipped_runs: 1,
			failed_runs: 0,
			verifiable_runs: 2,
			confirmed_on_chain: 2,
			failed_verification: 0,
			first_run_at: '2026-08-24T08:00:00Z',
			last_run_at: '2026-08-25T10:00:00Z',
		},
		caveats: [{ code: 'no_supply_context', text: 'Does not mean total supply is falling.' }],
		schedule: [
			{
				name: 'PEPE buy & burn',
				kind: 'buy_and_burn',
				cron: '0 * * * *',
				mode: 'live',
				armed: true,
				max_usd_per_run: 50,
				max_usd_per_day: 400,
				burn_address: '0xdead',
			},
		],
		runs: [
			{
				status: 'succeeded',
				reason: null,
				spend_usd: 50,
				token_amount: '1,200,000',
				tx_hash: '0xabcdef1234567890abcdef',
				explorer_url: 'https://basescan.org/tx/0xabcdef1234567890abcdef',
				started_at: '2026-08-25T10:00:00Z',
				verification: 'verified',
			},
			{
				status: 'skipped',
				reason: 'daily cap reached',
				spend_usd: 0,
				token_amount: null,
				tx_hash: null,
				explorer_url: null,
				started_at: '2026-08-24T08:00:00Z',
				verification: 'pending',
			},
		],
		disclosure: 'Every run this bot attempted is listed.',
		...over,
	}
}

describe('escaping — this page is public and renders tenant strings', () => {
	it('escapes the raw dangerous characters', () => {
		expect(esc(XSS)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
		expect(esc(ATTR)).toBe('&quot; onload=&quot;alert(1)')
		expect(esc("it's")).toBe('it&#39;s')
		expect(esc('a & b')).toBe('a &amp; b')
	})

	it('handles null and undefined without printing them', () => {
		expect(esc(null)).toBe('')
		expect(esc(undefined)).toBe('')
	})

	it('escapes a malicious bot name', () => {
		const html = renderProofPage(data({ bot: { ...data().bot, name: XSS } }))
		expect(html).not.toContain('<script>alert(1)</script>')
		expect(html).toContain('&lt;script&gt;')
	})

	it('escapes a malicious funding note', () => {
		const html = renderProofPage(
			data({ funding: { source: 'treasury', note: XSS } }),
		)
		expect(html).not.toContain('<script>alert(1)</script>')
	})

	it('escapes a malicious refusal reason', () => {
		const runs = data().runs
		runs[1] = { ...runs[1], reason: XSS }
		const html = renderProofPage(data({ runs }))
		expect(html).not.toContain('<script>alert(1)</script>')
	})

	it('escapes a malicious automation name and caveat text', () => {
		const html = renderProofPage(
			data({
				schedule: [{ ...data().schedule[0], name: XSS }],
				caveats: [{ code: 'x', text: XSS }],
			}),
		)
		expect(html).not.toContain('<script>alert(1)</script>')
	})

	it('cannot be tricked into an attribute break via the title', () => {
		const html = renderProofPage(data({ bot: { ...data().bot, name: ATTR } }))
		expect(html).not.toContain('" onload="alert(1)')
	})

	it('escapes a malicious token symbol and chain', () => {
		const html = renderProofPage(
			data({ bot: { ...data().bot, token_symbol: XSS, token_chain: XSS } }),
		)
		expect(html).not.toContain('<script>alert(1)</script>')
	})
})

describe('links — only ones we built', () => {
	it('accepts an https explorer link', () => {
		expect(safeUrl('https://basescan.org/tx/0xabc')).toBe('https://basescan.org/tx/0xabc')
	})

	it('refuses javascript:, data: and plain http', () => {
		// A javascript: href on a page holders are told to trust would be the
		// worst possible outcome for this feature.
		for (const bad of [
			'javascript:alert(1)',
			'JavaScript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'http://evil.example',
			'//evil.example',
			'',
		]) {
			expect(safeUrl(bad)).toBeNull()
		}
	})

	it('refuses non-strings', () => {
		expect(safeUrl(null)).toBeNull()
		expect(safeUrl(42)).toBeNull()
	})

	it('never emits an href for a run with no explorer link', () => {
		const runs = data().runs
		runs[0] = { ...runs[0], explorer_url: 'javascript:alert(1)' }
		const html = renderProofPage(data({ runs }))
		expect(html).not.toContain('javascript:')
	})
})

describe('the page keeps what makes it proof', () => {
	it('shows refused and dry runs, not just successes', () => {
		const html = renderProofPage(data())
		expect(html).toContain('Refused')
		expect(html).toContain('daily cap reached')
		expect(html).toContain('Dry runs (moved nothing)')
	})

	it('puts caveats above the numbers', () => {
		// Stating what the page does not prove is what makes the rest
		// believable; a footer would invert that.
		const html = renderProofPage(data())
		expect(html.indexOf('Does not mean total supply is falling')).toBeLessThan(
			html.indexOf('What the chain confirms'),
		)
	})

	it('marks a failed verification loudly', () => {
		const html = renderProofPage(
			data({
				totals: { ...data().totals, confirmed_on_chain: 1, failed_verification: 1 },
				caveats: [{ code: 'failed_verification', text: 'One run did NOT deliver.' }],
			}),
		)
		expect(html).toContain('caveat crit')
		expect(html).toContain('not confirmed')
	})

	it('states the funding source in words a holder understands', () => {
		expect(renderProofPage(data())).toContain('Recurring revenue or fees')
		expect(
			renderProofPage(data({ funding: { source: 'undisclosed', note: null } })),
		).toContain('Not stated by the team')
	})

	it('renders an empty history without pretending otherwise', () => {
		const html = renderProofPage(
			data({
				runs: [],
				headline: 'No burns executed yet',
				totals: { ...data().totals, executed_runs: 0, executed_spend_usd: 0, confirmed_on_chain: 0 },
			}),
		)
		expect(html).toContain('No runs yet.')
		expect(html).toContain('No burns executed yet')
	})

	it('is self-contained — no external assets or scripts', () => {
		// It renders in Telegram's in-app browser on a bad connection.
		const html = renderProofPage(data())
		expect(html).not.toContain('<script')
		expect(html).not.toMatch(/src=["']https?:/)
		expect(html).not.toMatch(/<link[^>]+stylesheet/)
	})

	it('is mobile-first and not indexable', () => {
		const html = renderProofPage(data())
		expect(html).toContain('width=device-width')
		expect(html).toContain('name="robots" content="noindex"')
	})
})
