import { describe, expect, it } from 'bun:test'
import jwt from 'jsonwebtoken'
import {
	ALLOWED_JWT_ALGORITHMS,
	PROOF_OF_POSSESSION_SRCS,
	verifyAuthJwt,
} from '../middleware/flexAuth'

const SECRET = 'test-jwt-secret-value'

// Mirrors the acceptance check in requireProofOfPossession()'s JWT branch:
// accept iff `src` is present AND in the allowlist.
function isProofOfPossession(src: string | undefined): boolean {
	return !!src && (PROOF_OF_POSSESSION_SRCS as readonly string[]).includes(src)
}

describe('flexAuth JWT algorithm allowlist (alg-confusion hardening)', () => {
	it('accepts a correctly-signed HS256 token', () => {
		const token = jwt.sign({ userId: 42, walletAddress: '0xabc' }, SECRET, {
			algorithm: 'HS256',
		})
		const decoded = verifyAuthJwt(token, SECRET)
		expect(decoded.userId).toBe(42)
		expect(decoded.walletAddress).toBe('0xabc')
	})

	it('rejects a token signed with a different HMAC algorithm (HS512) using the same secret', () => {
		// Pre-fix (no `algorithms` option) jsonwebtoken accepts any default alg for a
		// string secret, so this HS512 token would verify — an algorithm-confusion gap.
		// Post-fix the allowlist pins HS256, so verification must throw.
		const forged = jwt.sign({ userId: 999 }, SECRET, { algorithm: 'HS512' })
		expect(() => verifyAuthJwt(forged, SECRET)).toThrow()
	})

	it('pins the allowlist to HS256, matching the Python decoder', () => {
		expect([...ALLOWED_JWT_ALGORITHMS]).toEqual(['HS256'])
	})
})

describe('requireProofOfPossession() src claim gate', () => {
	it('defines the accepted set as exactly telegram, siwe, passkey', () => {
		expect([...PROOF_OF_POSSESSION_SRCS].sort()).toEqual(['passkey', 'siwe', 'telegram'])
	})

	it('accepts src=telegram (Telegram initData-backed mint)', () => {
		const token = jwt.sign({ userId: 1, src: 'telegram' }, SECRET, { algorithm: 'HS256' })
		const decoded = verifyAuthJwt(token, SECRET)
		expect(isProofOfPossession(decoded.src)).toBe(true)
	})

	it('accepts src=siwe (wallet-signature verified mint)', () => {
		const token = jwt.sign({ userId: 2, src: 'siwe' }, SECRET, { algorithm: 'HS256' })
		const decoded = verifyAuthJwt(token, SECRET)
		expect(isProofOfPossession(decoded.src)).toBe(true)
	})

	it('accepts src=passkey (WebAuthn-verified mint)', () => {
		const token = jwt.sign({ userId: 3, src: 'passkey' }, SECRET, { algorithm: 'HS256' })
		const decoded = verifyAuthJwt(token, SECRET)
		expect(isProofOfPossession(decoded.src)).toBe(true)
	})

	it('rejects a token with no src claim at all (the legacy publicSwap {userId, walletAddress} shape)', () => {
		const token = jwt.sign({ userId: 4, walletAddress: '0xabc' }, SECRET, { algorithm: 'HS256' })
		const decoded = verifyAuthJwt(token, SECRET)
		expect(decoded.src).toBeUndefined()
		expect(isProofOfPossession(decoded.src)).toBe(false)
	})

	it("rejects src='weak' (an explicit no-proof-of-possession mint, e.g. a refresh token)", () => {
		const token = jwt.sign({ userId: 5, src: 'weak' }, SECRET, { algorithm: 'HS256' })
		const decoded = verifyAuthJwt(token, SECRET)
		expect(isProofOfPossession(decoded.src)).toBe(false)
	})

	it('rejects an unrecognized src value (defense in depth against typos/new unvetted mints)', () => {
		const token = jwt.sign({ userId: 6, src: 'oauth-google' }, SECRET, { algorithm: 'HS256' })
		const decoded = verifyAuthJwt(token, SECRET)
		expect(isProofOfPossession(decoded.src)).toBe(false)
	})
})
