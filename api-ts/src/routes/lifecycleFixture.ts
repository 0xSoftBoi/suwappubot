import { Hono } from 'hono'
import { applyLifecycleHeaders, lifecycleRecord } from '../lib/apiLifecycle'

const lifecycleFixtureRoutes = new Hono()

function sandboxOpenApi() {
	const record = lifecycleRecord('sandbox.deprecation-fixture')
	return {
		openapi: '3.1.0',
		info: {
			title: 'Suwappu Contract Sandbox API',
			version: '1.0.0',
			description:
				'Deterministic no-funds integration-test surface. It never signs, broadcasts, charges, calls routing providers, or calls chain RPCs.',
		},
		servers: [{ url: 'https://api.suwappu.bot/v1/sandbox', description: 'No-funds contract sandbox' }],
		paths: {
			'/deprecated-fixture': {
				get: {
					summary: 'Deprecated lifecycle test fixture',
					deprecated: true,
					'x-suwappu-lifecycle': record.status,
					'x-suwappu-deprecation-at': record.deprecationAt,
					'x-suwappu-sunset-at': record.sunsetAt,
					'x-suwappu-deprecation-docs': record.documentationUrl,
					'x-suwappu-replacement': record.replacement,
					responses: {
						'200': {
							description: 'Synthetic lifecycle response; no funds or provider calls.',
						},
					},
				},
			},
		},
	}
}

lifecycleFixtureRoutes.get('/openapi', (c) => {
	c.header('Cache-Control', 'public, max-age=300')
	return c.json(sandboxOpenApi())
})

/**
 * Sandbox-only deprecated resource used by SDK/integration tests to verify
 * standards-based lifecycle handling without deprecating a real production API.
 */
lifecycleFixtureRoutes.get('/deprecated-fixture', (c) => {
	const record = lifecycleRecord('sandbox.deprecation-fixture')
	applyLifecycleHeaders(c, record)
	return c.json({
		environment: 'sandbox',
		fixture_only: true,
		lifecycle: record.status,
		deprecated_at: record.deprecationAt,
		sunset_at: record.sunsetAt,
		replacement: record.replacement,
		real_funds: false,
		broadcast: false,
	})
})

export { lifecycleFixtureRoutes, sandboxOpenApi }
