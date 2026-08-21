import rawOpenApi from '../../openapi-agent.json'
import developerContract from '../../developer-contract.json'
import { API_LIFECYCLE_REGISTRY, type ApiLifecycleRecord } from './apiLifecycle'

// JSON-compatible structural type. Keep this intentionally loose because the
// checked-in OpenAPI template contains vendor extensions and hand-authored prose.
type JsonObject = Record<string, any>

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

function relativeAgentPath(absolutePath: string): string | null {
	const basePath = developerContract.agentRest.basePath
	if (!absolutePath.startsWith(`${basePath}/`) && absolutePath !== basePath) return null
	const relative = absolutePath.slice(basePath.length)
	return relative || '/'
}

function applyLifecycleToOperation(spec: JsonObject, record: ApiLifecycleRecord) {
	if (record.fixtureOnly) return
	const relative = relativeAgentPath(record.path)
	if (!relative) return
	const operation = spec.paths?.[relative]?.[record.method.toLowerCase()]
	if (!operation) {
		throw new Error(`Lifecycle registry references missing OpenAPI operation: ${record.method} ${record.path}`)
	}
	operation['x-suwappu-lifecycle'] = record.status
	if (record.status === 'deprecated' || record.status === 'sunset') operation.deprecated = true
	if (record.deprecationAt) operation['x-suwappu-deprecation-at'] = record.deprecationAt
	if (record.sunsetAt) operation['x-suwappu-sunset-at'] = record.sunsetAt
	if (record.documentationUrl) operation['x-suwappu-deprecation-docs'] = record.documentationUrl
	if (record.replacement) operation['x-suwappu-replacement'] = record.replacement
}

export function buildPublicAgentOpenApi(): JsonObject {
	const spec = clone(rawOpenApi as JsonObject)
	const rest = developerContract.agentRest

	spec.info = spec.info ?? {}
	spec.info.version = rest.openapiRevision
	spec.info.description = [
		'Cross-chain execution API for AI agents and applications.',
		'',
		'Chain support is runtime-discovered. Do not embed a static chain count or list; use `GET /v1/agent/chains`.',
		'',
		'Execution authority is explicit: quote and simulation do not move funds; `POST /swap` prepares an unsigned self-custody transaction; `POST /swap/execute` is a separate managed execution capability that can move funds.',
		'',
		'Use `GET /v1/developer-contract` for API/package compatibility and sandbox guarantees, and `GET /v1/api-lifecycle` for deprecation/sunset records.',
	].join('\n')

	// devapi isolation is deliberately unverified. Do not advertise it as a
	// customer integration environment until #874 proves the boundary.
	spec.servers = [
		{
			url: `https://api.suwappu.bot${rest.basePath}`,
			description: 'Production',
		},
	]

	spec['x-suwappu-contract'] = {
		compatibilityMajor: rest.compatibilityMajor,
		openapiRevision: rest.openapiRevision,
		lifecycle: rest.lifecycle,
		developerContract: 'https://api.suwappu.bot/v1/developer-contract',
		lifecycleRegistry: 'https://api.suwappu.bot/v1/api-lifecycle',
		chainDiscovery: 'https://api.suwappu.bot/v1/agent/chains',
		sandbox: developerContract.sandbox.endpoint,
		sandboxKind: developerContract.sandbox.kind,
		devapiCustomerSandboxStatus: developerContract.sandbox.devapiCustomerSandboxStatus,
	}

	for (const record of Object.values(API_LIFECYCLE_REGISTRY.resources)) {
		applyLifecycleToOperation(spec, record)
	}

	return spec
}

export const PUBLIC_AGENT_OPENAPI = buildPublicAgentOpenApi()
