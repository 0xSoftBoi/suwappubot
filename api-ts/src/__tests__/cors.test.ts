import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createMcpOriginGuard, isCorsOriginAllowed } from '../middleware/cors'

describe('MCP Origin validation', () => {
	it('shares the configured CORS allowlist and only permits localhost outside production', () => {
		expect(isCorsOriginAllowed('https://suwappu.bot', 'https://suwappu.bot,https://app.example', true)).toBe(true)
		expect(isCorsOriginAllowed('https://evil.example', 'https://suwappu.bot', true)).toBe(false)
		expect(isCorsOriginAllowed('http://localhost:3000', 'https://suwappu.bot', false)).toBe(true)
		expect(isCorsOriginAllowed('http://localhost:3000', 'https://suwappu.bot', true)).toBe(false)
	})

	it('returns 403 for a disallowed Origin but allows non-browser and allowlisted requests', async () => {
		const app = new Hono()
		app.use('*', createMcpOriginGuard('https://suwappu.bot'))
		app.post('/', (c) => c.text('ok'))

		const blocked = await app.request('/', { method: 'POST', headers: { Origin: 'https://evil.example' } })
		expect(blocked.status).toBe(403)

		const allowed = await app.request('/', { method: 'POST', headers: { Origin: 'https://suwappu.bot' } })
		expect(allowed.status).toBe(200)

		const noOrigin = await app.request('/', { method: 'POST' })
		expect(noOrigin.status).toBe(200)
	})
})
