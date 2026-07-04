import { describe, expect, it } from 'bun:test'
import jwt from 'jsonwebtoken'
import { ALLOWED_JWT_ALGORITHMS, verifyAuthJwt } from '../middleware/flexAuth'

const SECRET = 'test-jwt-secret-value'

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
