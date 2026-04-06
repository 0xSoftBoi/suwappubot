import { describe, expect, it } from 'bun:test'
import { createTestApp } from './setup'

describe('health routes', () => {
	it('GET /health returns 200 with status ok', async () => {
		const { app, cleanup } = await createTestApp()

		try {
			const response = await app.request('/health')
			expect(response.status).toBe(200)

			const body = (await response.json()) as { status: string; service: string }
			expect(body.status).toBe('ok')
			expect(body.service).toBe('suwappu-api-ts')
		} finally {
			await cleanup()
		}
	})

	it('GET /health includes version field', async () => {
		const { app, cleanup } = await createTestApp()

		try {
			const response = await app.request('/health')
			expect(response.status).toBe(200)

			const body = (await response.json()) as { version?: string }
			expect(typeof body.version).toBe('string')
			expect(body.version?.length).toBeGreaterThan(0)
		} finally {
			await cleanup()
		}
	})
})
