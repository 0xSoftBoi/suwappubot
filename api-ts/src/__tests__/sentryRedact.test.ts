import { describe, expect, it } from 'bun:test'
import { isSensitiveKey, redactSecretsInText, redactSensitiveData } from '../lib/sentryRedact'

describe('redactSecretsInText', () => {
	// Key-based matching cannot catch a secret interpolated into a message.
	// `new Error(\`sign failed for ${pk}\`)` lands in exception.values[].value
	// as plain text under a benign key.
	it('redacts an EVM private key pasted into a message', () => {
		const pk = `0x${'ab'.repeat(32)}`
		const out = redactSecretsInText(`sign failed for ${pk}`)
		expect(out).not.toContain(pk)
		expect(out).toContain('[REDACTED]')
		expect(out).toContain('sign failed for')
	})

	it('redacts hex secrets that are not exactly 64 chars', () => {
		// A \b-anchored {64} pattern cannot match inside a longer hex run, so
		// 128-hex (ed25519 keypair hex) used to pass through untouched.
		const long = 'cd'.repeat(64)
		expect(redactSecretsInText(`key ${long}`)).not.toContain(long)
	})

	it('redacts JWTs, bot tokens and AWS key ids', () => {
		const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'
		const bot = '1234567890:AAHfiqksKZ8WmR2zSjiQ7_v4swadNQbY5Vv'
		expect(redactSecretsInText(jwt)).not.toContain(jwt)
		expect(redactSecretsInText(bot)).not.toContain(bot)
		expect(redactSecretsInText('id AKIAIOSFODNN7EXAMPLE')).not.toContain('AKIAIOSFODNN7EXAMPLE')
	})

	it('strips the credential from an RPC URL but keeps the host', () => {
		// These keys sit in the URL *path*, under the benign key "url".
		const out = redactSecretsInText('GET https://eth-mainnet.g.alchemy.com/v2/SUPERSECRET failed')
		expect(out).not.toContain('SUPERSECRET')
		expect(out).toContain('alchemy.com') // still diagnosable
	})

	it('leaves ordinary text alone', () => {
		const msg = 'swap failed: insufficient liquidity on chain 8453'
		expect(redactSecretsInText(msg)).toBe(msg)
	})
})

describe('sentryRedact', () => {
	it('redacts a nested private key and an Authorization header', () => {
		const payload = {
			request: {
				headers: {
					Authorization: 'Bearer super-secret-token',
					'x-api-key': 'sk_live_abc123',
					'content-type': 'application/json',
				},
				cookies: { session: 'sid=abc' },
			},
			extra: {
				wallet: {
					address: '0xabc123',
					privateKey: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
					nested: {
						mnemonic: 'test seed phrase words here',
						encryptedKey: 'kms-blob-xyz',
					},
				},
				user: { id: 42, jwt: 'eyJhbGciOi...' },
			},
		}

		const redacted = redactSensitiveData(payload) as typeof payload

		// Sensitive values scrubbed
		expect(redacted.request.headers.Authorization).toBe('[REDACTED]')
		expect(redacted.request.headers['x-api-key']).toBe('[REDACTED]')
		expect(redacted.extra.wallet.privateKey).toBe('[REDACTED]')
		expect(redacted.extra.wallet.nested.mnemonic).toBe('[REDACTED]')
		expect(redacted.extra.wallet.nested.encryptedKey).toBe('[REDACTED]')
		expect(redacted.extra.user.jwt).toBe('[REDACTED]')
		// "cookies" key itself matches the sensitive pattern, so the whole value is redacted
		expect(redacted.request.cookies as unknown as string).toBe('[REDACTED]')

		// Non-sensitive values preserved
		expect(redacted.request.headers['content-type']).toBe('application/json')
		expect(redacted.extra.wallet.address).toBe('0xabc123')
		expect(redacted.extra.user.id).toBe(42)

		// Original object is untouched (defensive copy)
		expect(payload.extra.wallet.privateKey).not.toBe('[REDACTED]')
	})

	it('handles arrays and circular references without throwing', () => {
		const circular: Record<string, unknown> = { secret: 'shh', list: [{ token: 'abc' }, { ok: true }] }
		circular.self = circular

		expect(() => redactSensitiveData(circular)).not.toThrow()
		const redacted = redactSensitiveData(circular) as typeof circular
		expect(redacted.secret).toBe('[REDACTED]')
		expect((redacted.list as Array<Record<string, unknown>>)[0]?.token).toBe('[REDACTED]')
		expect((redacted.list as Array<Record<string, unknown>>)[1]?.ok).toBe(true)
	})

	// Regression: both of these were fail-OPEN leak paths. A depth-capped or
	// repeated subtree used to be returned raw, so a secret nested deeply enough
	// — or simply referenced twice — bypassed redaction entirely.
	it('fails closed past the depth cap instead of emitting raw values', () => {
		// Build a chain deeper than MAX_DEPTH with a secret at the very bottom.
		const deep: Record<string, unknown> = { privateKey: '0xLEAKED' }
		let node: Record<string, unknown> = deep
		for (let i = 0; i < 25; i++) node = { child: node }

		const redacted = redactSensitiveData(node)
		const serialized = JSON.stringify(redacted)

		expect(serialized).not.toContain('0xLEAKED')
		expect(serialized).toContain('[REDACTED')
	})

	it('redacts a repeated (non-circular) reference on every occurrence', () => {
		// The same object attached in two places is not a cycle. The second
		// visit must still come back redacted, not raw.
		const shared = { privateKey: '0xLEAKED', label: 'wallet' }
		const payload = { first: shared, second: shared }

		const redacted = redactSensitiveData(payload) as Record<
			string,
			Record<string, unknown>
		>

		expect(redacted.first?.privateKey).toBe('[REDACTED]')
		expect(redacted.second?.privateKey).toBe('[REDACTED]')
		expect(JSON.stringify(redacted)).not.toContain('0xLEAKED')
		// Non-sensitive data on the shared object still survives.
		expect(redacted.second?.label).toBe('wallet')
	})

	it('recognizes the full sensitive-key pattern list', () => {
		const keys = [
			'privateKey',
			'private_key',
			'secret',
			'mnemonic',
			'seed',
			'password',
			'token',
			'apiKey',
			'api_key',
			'authorization',
			'cookie',
			'session',
			'encryptedKey',
			'kms',
			'dek',
			'jwt',
			'x-api-key',
		]
		for (const key of keys) {
			expect(isSensitiveKey(key)).toBe(true)
		}
		expect(isSensitiveKey('walletAddress')).toBe(false)
		expect(isSensitiveKey('amount')).toBe(false)
	})
})
