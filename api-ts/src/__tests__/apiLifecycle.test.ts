import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { API_LIFECYCLE_REGISTRY, deprecationHeaderValue, sunsetHeaderValue } from '../lib/apiLifecycle'
import { healthRoutes } from '../routes/health'

function app() {
	const instance = new Hono()
	instance.route('/', healthRoutes)
	return instance
}

describe('API lifecycle contract', () => {
	it('serializes RFC 9745 Deprecation and RFC 8594 Sunset correctly', () => {
		const record = API_LIFECYCLE_REGISTRY.resources['sandbox.deprecation-fixture']
		expect(record).toBeDefined()
		expect(deprecationHeaderValue(record.deprecationAt!)).toBe(`@${Math.floor(Date.parse(record.deprecationAt!) / 1000)}`)
		expect(sunsetHeaderValue(record.sunsetAt!)).toBe(new Date(record.sunsetAt!).toUTCString())
		expect(Date.parse(record.sunsetAt!)).toBeGreaterThanOrEqual(Date.parse(record.deprecationAt!))
	})

	it('exposes a sandbox-only deprecated fixture with standards-based headers', async () => {
		const res = await app().request('/v1/sandbox/deprecated-fixture')
		expect(res.status).toBe(200)
		const record = API_LIFECYCLE_REGISTRY.resources['sandbox.deprecation-fixture']
		expect(res.headers.get('Deprecation')).toBe(deprecationHeaderValue(record.deprecationAt!))
		expect(res.headers.get('Sunset')).toBe(sunsetHeaderValue(record.sunsetAt!))
		expect(res.headers.get('Link')).toBe(`<${record.documentationUrl}>; rel="deprecation"`)
		expect(res.headers.get('X-Suwappu-Lifecycle')).toBe('deprecated')
		expect(res.headers.get('X-Suwappu-Replacement')).toBe('/v1/sandbox')
		const body = (await res.json()) as Record<string, any>
		expect(body.fixture_only).toBe(true)
		expect(body.real_funds).toBe(false)
		expect(body.broadcast).toBe(false)
	})

	it('publishes matching OpenAPI lifecycle metadata for the fixture', async () => {
		const res = await app().request('/v1/sandbox/openapi')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, any>
		const operation = body.paths['/deprecated-fixture'].get
		const record = API_LIFECYCLE_REGISTRY.resources['sandbox.deprecation-fixture']
		expect(operation.deprecated).toBe(true)
		expect(operation['x-suwappu-lifecycle']).toBe('deprecated')
		expect(operation['x-suwappu-deprecation-at']).toBe(record.deprecationAt)
		expect(operation['x-suwappu-sunset-at']).toBe(record.sunsetAt)
		expect(operation['x-suwappu-deprecation-docs']).toBe(record.documentationUrl)
		expect(operation['x-suwappu-replacement']).toBe('/v1/sandbox')
	})

	it('publishes the lifecycle registry for machine discovery', async () => {
		const res = await app().request('/v1/api-lifecycle')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, any>
		expect(body.standards.deprecation).toBe('RFC 9745')
		expect(body.standards.sunset).toBe('RFC 8594')
		expect(body.resources['sandbox.deprecation-fixture'].status).toBe('deprecated')
	})

	it('publishes categorized API changes as JSON and Atom', async () => {
		const json = await app().request('/v1/api-changelog')
		expect(json.status).toBe(200)
		const body = (await json.json()) as Record<string, any>
		expect(body.categories).toEqual(['Breaking', 'Deprecated', 'Security', 'Added', 'Changed', 'Fixed'])
		expect(body.entries[0].category).toBe('Deprecated')
		expect(body.entries[0].affected).toContain('GET /v1/sandbox/deprecated-fixture')

		const atom = await app().request('/v1/api-changelog.atom')
		expect(atom.status).toBe(200)
		expect(atom.headers.get('Content-Type')).toContain('application/atom+xml')
		const xml = await atom.text()
		expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
		expect(xml).toContain('[Deprecated] Sandbox deprecation lifecycle fixture')
		expect(xml).toContain('2026-08-21-sandbox-deprecation-fixture')
	})

	it('serves normalized OpenAPI with no stale chain count or unverified devapi server', async () => {
		const res = await app().request('/v1/agent/openapi')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, any>
		const description = String(body.info.description)
		expect(description).toContain('GET /v1/agent/chains')
		expect(description).not.toMatch(/7\+\s*chains/i)
		expect(description).not.toMatch(/40\+\s*chains/i)
		expect(body.servers).toEqual([
			{ url: 'https://api.suwappu.bot/v1/agent', description: 'Production' },
		])
		expect(body['x-suwappu-contract'].compatibilityMajor).toBe('v1')
		expect(body['x-suwappu-contract'].lifecycleRegistry).toBe('https://api.suwappu.bot/v1/api-lifecycle')
		expect(body['x-suwappu-contract'].devapiCustomerSandboxStatus).toBe('unverified-do-not-assume-isolated')
	})
})
