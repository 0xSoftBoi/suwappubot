import { Hono } from 'hono'
import { applyLifecycleHeaders, lifecycleRecord } from '../lib/apiLifecycle'

const lifecycleFixtureRoutes = new Hono()

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

export { lifecycleFixtureRoutes }
