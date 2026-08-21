#!/usr/bin/env bun

import { API_LIFECYCLE_REGISTRY, validateLifecycleRegistry } from '../src/lib/apiLifecycle'
import { PUBLIC_AGENT_OPENAPI } from '../src/lib/publicOpenApi'
import developerContract from '../developer-contract.json'

function invariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Public contract violation: ${message}`)
}

validateLifecycleRegistry()

const description = String(PUBLIC_AGENT_OPENAPI.info?.description ?? '')
invariant(!/7\+\s*chains/i.test(description), 'served OpenAPI still publishes the stale 7+ chains claim')
invariant(!/40\+\s*chains/i.test(description), 'served OpenAPI publishes a static 40+ chains claim')
invariant(description.includes('GET /v1/agent/chains'), 'served OpenAPI must direct clients to runtime chain discovery')

const servers = Array.isArray(PUBLIC_AGENT_OPENAPI.servers) ? PUBLIC_AGENT_OPENAPI.servers : []
invariant(servers.length === 1, 'served OpenAPI must expose exactly one verified public server until sandbox isolation is proven')
invariant(
	servers[0]?.url === `https://api.suwappu.bot${developerContract.agentRest.basePath}`,
	'served OpenAPI canonical server does not match developer contract',
)
invariant(
	!servers.some((server: { url?: string }) => /devapi\.suwappu\.bot/i.test(server.url ?? '')),
	'served OpenAPI must not advertise devapi as a customer environment while isolation is unverified',
)

const metadata = PUBLIC_AGENT_OPENAPI['x-suwappu-contract'] as Record<string, unknown> | undefined
invariant(metadata?.compatibilityMajor === developerContract.agentRest.compatibilityMajor, 'served OpenAPI compatibility major drift')
invariant(metadata?.openapiRevision === developerContract.agentRest.openapiRevision, 'served OpenAPI revision drift')
invariant(metadata?.chainDiscovery === 'https://api.suwappu.bot/v1/agent/chains', 'served OpenAPI chain discovery URL drift')
invariant(metadata?.developerContract === 'https://api.suwappu.bot/v1/developer-contract', 'served OpenAPI developer contract URL drift')
invariant(metadata?.lifecycleRegistry === 'https://api.suwappu.bot/v1/api-lifecycle', 'served OpenAPI lifecycle registry URL drift')
invariant(metadata?.sandbox === developerContract.sandbox.endpoint, 'served OpenAPI sandbox endpoint drift')
invariant(
	metadata?.devapiCustomerSandboxStatus === 'unverified-do-not-assume-isolated',
	'served OpenAPI must preserve the unverified devapi isolation warning',
)

for (const [name, record] of Object.entries(API_LIFECYCLE_REGISTRY.resources)) {
	if (record.fixtureOnly) continue
	if (!record.path.startsWith(`${developerContract.agentRest.basePath}/`)) continue
	const relative = record.path.slice(developerContract.agentRest.basePath.length)
	const operation = PUBLIC_AGENT_OPENAPI.paths?.[relative]?.[record.method.toLowerCase()]
	invariant(operation, `lifecycle resource ${name} is missing from served OpenAPI`)
	invariant(operation['x-suwappu-lifecycle'] === record.status, `lifecycle metadata drift for ${name}`)
	if (record.status === 'deprecated' || record.status === 'sunset') {
		invariant(operation.deprecated === true, `deprecated/sunset resource ${name} is not marked deprecated in OpenAPI`)
	}
}

console.log(
	`✓ Public contract valid: REST ${developerContract.agentRest.compatibilityMajor}, OpenAPI ${developerContract.agentRest.openapiRevision}, ` +
		`${Object.keys(API_LIFECYCLE_REGISTRY.resources).length} lifecycle record(s), verified production server only.`,
)
