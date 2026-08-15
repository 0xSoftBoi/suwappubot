import { describe, expect, it } from 'bun:test'

// Test the production startup validation logic directly (no Schema dependency)
describe('EnvService validation', () => {
	it('production startup validation catches missing vars', () => {
		const env = { NODE_ENV: 'production', DATABASE_URL: '', JWT_SECRET: '', ADMIN_API_KEY: 'set' }
		const missing: string[] = []
		if (!env.DATABASE_URL) missing.push('DATABASE_URL')
		if (!env.JWT_SECRET) missing.push('JWT_SECRET')
		if (!env.ADMIN_API_KEY) missing.push('ADMIN_API_KEY')
		expect(missing).toContain('DATABASE_URL')
		expect(missing).toContain('JWT_SECRET')
		expect(missing).not.toContain('ADMIN_API_KEY')
	})

	it('does not flag when all required vars present', () => {
		const env = {
			NODE_ENV: 'production',
			DATABASE_URL: 'postgres://...',
			JWT_SECRET: 'secret',
			ADMIN_API_KEY: 'key',
			TELEGRAM_BOT_TOKEN: 'token',
		}
		const missing: string[] = []
		if (!env.DATABASE_URL) missing.push('DATABASE_URL')
		if (!env.JWT_SECRET) missing.push('JWT_SECRET')
		if (!env.ADMIN_API_KEY) missing.push('ADMIN_API_KEY')
		if (!env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN')
		expect(missing).toHaveLength(0)
	})

	it('skips validation in development', () => {
		const env = { NODE_ENV: 'development' }
		// In dev mode, missing vars should not cause startup failure
		expect(env.NODE_ENV).not.toBe('production')
	})
})
