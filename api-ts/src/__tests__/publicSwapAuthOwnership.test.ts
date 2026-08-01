import { describe, expect, it } from 'bun:test'
import { assertQuoteReceiverMatchesWallet, publicSwapRoutes } from '../routes/publicSwap'

// Regression tests for a LIVE account-takeover in POST /public/swap/auth
// (C1) and a placeholder-receiver signing bug in POST /public/swap/execute
// (H5). See publicSwap.ts for the full writeup.
//
// C1 (old behaviour, now fixed): the handler took `{subOrgId, walletAddress}`
// from an UNAUTHENTICATED body, looked up the wallet row by address (public
// on-chain data), and minted a 7-day JWT for that row's userId with NO proof
// the caller controls the wallet/sub-org. Anyone could mint anyone else's
// session and drain them via /public/swap/execute. The fix requires a
// Turnkey stamped-whoami proof before any JWT is minted, and fails closed
// (401) when it's missing or invalid.

const VICTIM_ADDRESS = '0x1234567890123456789012345678901234567890'
const ATTACKER_CLAIMED_SUBORG = 'attacker-controlled-sub-org-id'

describe('POST /public/swap/auth — ownership proof required (C1 fix)', () => {
	it('rejects an address-only request (no stampedWhoami) with 401, and never mints a JWT', async () => {
		// This is exactly the old exploit payload: no proof of control, just the
		// victim's public wallet address and an attacker-chosen subOrgId.
		const res = await publicSwapRoutes.request('/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				subOrgId: ATTACKER_CLAIMED_SUBORG,
				walletAddress: VICTIM_ADDRESS,
			}),
		})

		expect(res.status).toBe(401)
		const json = await res.json()
		expect(json.jwt).toBeUndefined()
		expect(JSON.stringify(json)).toMatch(/stampedWhoami|proof|Unauthorized/i)
	})

	it('rejects a request with a malformed/incomplete stampedWhoami (missing stamp headers) with 401', async () => {
		const res = await publicSwapRoutes.request('/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				subOrgId: ATTACKER_CLAIMED_SUBORG,
				walletAddress: VICTIM_ADDRESS,
				// stamp object present but incomplete — must still fail closed.
				stampedWhoami: { url: 'https://api.turnkey.com/public/v1/query/whoami', body: '{}' },
			}),
		})

		expect(res.status).toBe(401)
		const json = await res.json()
		expect(json.jwt).toBeUndefined()
	})

	it('still requires subOrgId and walletAddress at all (basic validation unchanged)', async () => {
		const res = await publicSwapRoutes.request('/auth', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		})
		expect(res.status).toBe(400)
	})
})

describe('assertQuoteReceiverMatchesWallet — placeholder-receiver signing gate (H5 fix)', () => {
	const WALLET = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
	const PLACEHOLDER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' // vitalik.eth placeholder

	it('refuses to sign when the quote receiver is the placeholder, not the executing wallet', () => {
		const quote = { _rawQuote: { action: { toAddress: PLACEHOLDER } } }
		const result = assertQuoteReceiverMatchesWallet(quote, WALLET)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.reason).toMatch(/receiver/i)
		}
	})

	it('refuses to sign when the quote has no receiver at all', () => {
		const quote = { _rawQuote: { action: {} } }
		const result = assertQuoteReceiverMatchesWallet(quote, WALLET)
		expect(result.ok).toBe(false)
	})

	it('allows signing when the quote receiver matches the executing wallet (case-insensitive)', () => {
		const quote = { _rawQuote: { action: { toAddress: WALLET.toLowerCase() } } }
		const result = assertQuoteReceiverMatchesWallet(quote, WALLET)
		expect(result.ok).toBe(true)
	})
})
