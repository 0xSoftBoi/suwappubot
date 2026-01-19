import { Hono } from 'hono'
import packageJson from '../../package.json'

const healthRoutes = new Hono()

healthRoutes.get('/health', (c) => {
	return c.json({
		status: 'ok',
		service: 'suwappu-api-ts',
		version: packageJson.version,
		timestamp: new Date().toISOString(),
	})
})

export { healthRoutes }
