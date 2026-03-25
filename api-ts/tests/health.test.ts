import { describe, expect, it } from 'bun:test'
import { createApp } from '../src/app'

const app = createApp({ allowedOrigins: 'http://localhost:3000' })

describe('GET /health', () => {
	it('returns 200 with expected structure', async () => {
		const res = await app.request('/health')
		expect(res.status).toBe(200)

		const body = await res.json()
		expect(body).toHaveProperty('status')
		expect(body).toHaveProperty('service', 'suwappu-api-ts')
		expect(body).toHaveProperty('version')
		expect(body).toHaveProperty('timestamp')
		expect(typeof body.timestamp).toBe('string')
	})

	it('returns ISO timestamp', async () => {
		const res = await app.request('/health')
		const body = await res.json()
		const parsed = new Date(body.timestamp)
		expect(parsed.toISOString()).toBe(body.timestamp)
	})
})

describe('GET /chains', () => {
	it('returns a list of supported chains', async () => {
		const res = await app.request('/chains')
		expect(res.status).toBe(200)

		const body = await res.json()
		expect(body).toHaveProperty('chains')
		expect(Array.isArray(body.chains)).toBe(true)
		expect(body.chains.length).toBeGreaterThan(0)

		const chain = body.chains[0]
		expect(chain).toHaveProperty('id')
		expect(chain).toHaveProperty('key')
		expect(chain).toHaveProperty('name')
	})
})
