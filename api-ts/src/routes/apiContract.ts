import { Hono } from 'hono'
import developerContract from '../../developer-contract.json'
import { API_CHANGELOG, buildApiChangelogAtom } from '../lib/apiChangelog'
import { API_LIFECYCLE_REGISTRY } from '../lib/apiLifecycle'
import { PUBLIC_AGENT_OPENAPI } from '../lib/publicOpenApi'

const apiContractRoutes = new Hono()

apiContractRoutes.get('/v1/agent/openapi', (c) => {
	c.header('Cache-Control', 'public, max-age=300')
	return c.json(PUBLIC_AGENT_OPENAPI)
})

apiContractRoutes.get('/v1/developer-contract', (c) => {
	c.header('Cache-Control', 'public, max-age=300')
	return c.json(developerContract)
})

apiContractRoutes.get('/v1/api-lifecycle', (c) => {
	c.header('Cache-Control', 'public, max-age=300')
	return c.json(API_LIFECYCLE_REGISTRY)
})

apiContractRoutes.get('/v1/api-changelog', (c) => {
	c.header('Cache-Control', 'public, max-age=300')
	return c.json(API_CHANGELOG)
})

apiContractRoutes.get('/v1/api-changelog.atom', (c) => {
	c.header('Cache-Control', 'public, max-age=300')
	c.header('Content-Type', 'application/atom+xml; charset=utf-8')
	return c.body(buildApiChangelogAtom())
})

export { apiContractRoutes }
