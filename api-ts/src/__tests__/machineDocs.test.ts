import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { healthRoutes } from '../routes/health'
import { buildLlmsFullTxt, buildLlmsTxt, listAgentRestOperations } from '../lib/machineDocs'

function app() {
	const instance = new Hono()
	instance.route('/', healthRoutes)
	return instance
}

describe('generated machine documentation', () => {
	it('derives the short document from canonical contract metadata', () => {
		const doc = buildLlmsTxt()
		expect(doc).toContain('REST compatibility major: v1')
		expect(doc).toContain('Chain support: runtime-discovered')
		expect(doc).toContain('POST /v1/agent/swap/simulate')
		expect(doc).toContain('POST /v1/agent/swap — prepare an unsigned self-custody transaction')
		expect(doc).toContain('POST /v1/agent/swap/execute — managed execution; can move funds')
		expect(doc).not.toMatch(/\b\d+\+\s+chains\b/i)
		expect(doc).not.toContain('devapi.suwappu.bot')
		expect(doc).not.toContain('PyPI: suwappu')
	})

	it('has exactly one full-reference line per served OpenAPI HTTP operation', () => {
		const doc = buildLlmsFullTxt()
		const operations = listAgentRestOperations()
		const lines = doc
			.split('\n')
			.filter((line) => /^- (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) \/v1\/agent(?:\/|\b)/.test(line))
		expect(lines).toHaveLength(operations.length)

		for (const operation of operations) {
			const prefix = `- ${operation.method} ${operation.absolutePath} —`
			expect(lines.filter((line) => line.startsWith(prefix))).toHaveLength(1)
		}
	})

	it('serves the generated short and full documents from the public contract router', async () => {
		const shortResponse = await app().request('/llms.txt')
		expect(shortResponse.status).toBe(200)
		expect(shortResponse.headers.get('content-type')).toContain('text/markdown')
		const shortBody = await shortResponse.text()
		expect(shortBody).toBe(buildLlmsTxt())

		const fullResponse = await app().request('/llms-full.txt')
		expect(fullResponse.status).toBe(200)
		expect(fullResponse.headers.get('content-type')).toContain('text/markdown')
		const fullBody = await fullResponse.text()
		expect(fullBody).toBe(buildLlmsFullTxt())
	})

	it('fails closed when a canonical journey route disappears from OpenAPI', () => {
		const malformed = {
			openapi: '3.1.0',
			info: { title: 'fixture', version: '0.0.0' },
			servers: [{ url: 'https://api.suwappu.bot/v1/agent' }],
			paths: {},
		}
		expect(() => buildLlmsTxt(malformed)).toThrow('references missing OpenAPI operation')
	})
})
