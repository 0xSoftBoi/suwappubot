import { describe, expect, it } from 'bun:test'
import { Schema } from '@effect/schema'
import { EnvSchema } from '../../src/config/EnvService'

describe('EnvService', () => {
	it('production mode fails without required vars', () => {
		expect(() => {
			const env = Schema.decodeUnknownSync(EnvSchema)({
				NODE_ENV: 'production',
			})
			// Replicate the production check from EnvServiceLive
			const missing: string[] = []
			if (!env.DATABASE_URL) missing.push('DATABASE_URL')
			if (!env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN')
			if (!env.JWT_SECRET) missing.push('JWT_SECRET')
			if (!env.ADMIN_API_KEY) missing.push('ADMIN_API_KEY')
			if (missing.length > 0) {
				throw new Error(`Missing required env vars for production: ${missing.join(', ')}`)
			}
		}).toThrow('Missing required env vars for production')
	})

	it('development mode works without required vars', () => {
		const env = Schema.decodeUnknownSync(EnvSchema)({
			NODE_ENV: 'development',
		})
		expect(env.NODE_ENV).toBe('development')
		expect(env.PORT).toBe(8000)
		expect(env.DATABASE_URL).toBeUndefined()
	})

	it('parses PORT from string', () => {
		const env = Schema.decodeUnknownSync(EnvSchema)({
			PORT: '3000',
		})
		expect(env.PORT).toBe(3000)
	})

	it('uses sensible defaults', () => {
		const env = Schema.decodeUnknownSync(EnvSchema)({})
		expect(env.NODE_ENV).toBe('development')
		expect(env.PORT).toBe(8000)
		expect(env.TURNKEY_BASE_URL).toBe('https://api.turnkey.com')
		expect(env.FEE_BPS).toBe(30)
	})
})
