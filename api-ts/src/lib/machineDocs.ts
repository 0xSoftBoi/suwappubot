import developerContract from '../../developer-contract.json'
import { PUBLIC_AGENT_OPENAPI } from './publicOpenApi'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const

type HttpMethod = (typeof HTTP_METHODS)[number]
type JsonObject = Record<string, any>

export type MachineRestOperation = {
	method: Uppercase<HttpMethod>
	relativePath: string
	absolutePath: string
	operationId: string | null
	summary: string
	auth: 'public' | 'authenticated' | 'contract-defined'
	lifecycle: string
}

const QUICKSTART_STEPS: Array<{
	method: Uppercase<HttpMethod>
	path: string
	purpose: string
}> = [
	{ method: 'POST', path: '/register', purpose: 'register and obtain a developer credential' },
	{ method: 'GET', path: '/chains', purpose: 'discover the current chain registry' },
	{ method: 'POST', path: '/quote', purpose: 'obtain a quote without moving funds' },
	{ method: 'POST', path: '/swap/simulate', purpose: 'evaluate a proposed swap before execution' },
	{ method: 'POST', path: '/swap', purpose: 'prepare an unsigned self-custody transaction' },
]

const MANAGED_EXECUTE = {
	method: 'POST' as const,
	path: '/swap/execute',
	purpose: 'managed execution; can move funds and requires explicit authority',
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

function effectiveSecurity(operation: JsonObject, spec: JsonObject): unknown {
	if (Object.prototype.hasOwnProperty.call(operation, 'security')) return operation.security
	return spec.security
}

function authLabel(operation: JsonObject, spec: JsonObject): MachineRestOperation['auth'] {
	const security = effectiveSecurity(operation, spec)
	if (Array.isArray(security)) {
		if (security.length === 0) return 'public'
		if (security.length > 0) return 'authenticated'
	}
	return 'contract-defined'
}

export function listAgentRestOperations(spec: JsonObject = PUBLIC_AGENT_OPENAPI): MachineRestOperation[] {
	const basePath = developerContract.agentRest.basePath
	const operations: MachineRestOperation[] = []

	for (const relativePath of Object.keys(spec.paths ?? {}).sort()) {
		const pathItem = spec.paths?.[relativePath]
		if (!pathItem || typeof pathItem !== 'object') continue

		for (const method of HTTP_METHODS) {
			const operation = pathItem[method]
			if (!operation || typeof operation !== 'object') continue
			operations.push({
				method: method.toUpperCase() as Uppercase<HttpMethod>,
				relativePath,
				absolutePath: `${basePath}${relativePath === '/' ? '' : relativePath}`,
				operationId: typeof operation.operationId === 'string' ? operation.operationId : null,
				summary:
					typeof operation.summary === 'string' && operation.summary.trim()
						? operation.summary.trim()
						: typeof operation.description === 'string' && operation.description.trim()
							? operation.description.trim().split('\n')[0]
							: 'See OpenAPI operation contract',
				auth: authLabel(operation, spec),
				lifecycle:
					typeof operation['x-suwappu-lifecycle'] === 'string'
						? operation['x-suwappu-lifecycle']
						: developerContract.agentRest.lifecycle,
			})
		}
	}

	return operations.sort((a, b) =>
		a.absolutePath === b.absolutePath
			? a.method.localeCompare(b.method)
			: a.absolutePath.localeCompare(b.absolutePath),
	)
}

function operationKey(method: string, relativePath: string): string {
	return `${method.toUpperCase()} ${relativePath}`
}

function operationIndex(operations: MachineRestOperation[]): Map<string, MachineRestOperation> {
	return new Map(operations.map((operation) => [operationKey(operation.method, operation.relativePath), operation]))
}

function requireOperation(
	index: Map<string, MachineRestOperation>,
	method: string,
	path: string,
): MachineRestOperation {
	const operation = index.get(operationKey(method, path))
	if (!operation) {
		throw new Error(`Machine-doc canonical journey references missing OpenAPI operation: ${method} ${path}`)
	}
	return operation
}

function discoveryLines(): string[] {
	return Object.entries(developerContract.agentRest.discovery).map(
		([name, route]) => `- ${name}: ${route}`,
	)
}

function packageLines(): string[] {
	const packages = developerContract.packages
	return [
		`- TypeScript SDK: ${packages.typescriptSdk.name} (${packages.typescriptSdk.publication}; API ${packages.typescriptSdk.compatibleApiMajors.join(', ')})`,
		`- MCP bridge: ${packages.mcpBridge.name} (${packages.mcpBridge.publication}); hosted runtime is catalog authority`,
		`- Python SDK: ${packages.pythonSdk.publication}; production source installs must ${packages.pythonSdk.productionInstall}`,
	]
}

export function buildLlmsTxt(spec: JsonObject = PUBLIC_AGENT_OPENAPI): string {
	const publicSpec = clone(spec)
	const operations = listAgentRestOperations(publicSpec)
	const index = operationIndex(operations)
	const safeJourney = QUICKSTART_STEPS.map((step) => ({
		...step,
		operation: requireOperation(index, step.method, step.path),
	}))
	const managed = requireOperation(index, MANAGED_EXECUTE.method, MANAGED_EXECUTE.path)
	const productionServer = publicSpec.servers?.[0]?.url

	if (typeof productionServer !== 'string' || !productionServer.startsWith('https://api.suwappu.bot/')) {
		throw new Error('Machine docs require the verified production OpenAPI server')
	}

	return `${[
		'# Suwappu Developer API',
		'',
		'> Machine-generated discovery summary. REST endpoints come from the served public OpenAPI contract; protocol/package authority comes from the developer contract. Do not treat this file as an independent capability inventory.',
		'',
		'## Contract identity',
		`- REST compatibility major: ${developerContract.agentRest.compatibilityMajor}`,
		`- OpenAPI revision: ${developerContract.agentRest.openapiRevision}`,
		`- Lifecycle stage: ${developerContract.agentRest.lifecycle}`,
		`- REST base URL: ${productionServer}`,
		'- Chain support: runtime-discovered; use GET /v1/agent/chains rather than embedding a static count or list.',
		'',
		'## Safe first integration',
		...safeJourney.map(
			(step, index) =>
				`${index + 1}. ${step.operation.method} ${step.operation.absolutePath} — ${step.purpose}. ${step.operation.summary}`,
		),
		'',
		'## Authority escalation',
		`- ${managed.method} ${managed.absolutePath} — ${MANAGED_EXECUTE.purpose}. ${managed.summary}`,
		'- Quote, simulation, and unsigned preparation are not permission to enable managed execution. Apply application-owned policy and reconcile ambiguous outcomes before retrying a money-moving operation.',
		'',
		'## Machine discovery',
		...discoveryLines(),
		'- llmsFull: GET /llms-full.txt',
		'',
		'## Protocols',
		`- MCP: ${developerContract.hostedProtocols.mcp.endpoint}; discover tools/resources from the hosted runtime.`,
		`- A2A: capabilities are authoritative in ${developerContract.hostedProtocols.a2a.agentCard}.`,
		'',
		'## Packages',
		...packageLines(),
		'',
		'## Sandbox',
		`- ${developerContract.sandbox.endpoint} — ${developerContract.sandbox.kind}; real funds=${developerContract.sandbox.realFunds}, signing=${developerContract.sandbox.signing}, broadcast=${developerContract.sandbox.broadcast}, production DB=${developerContract.sandbox.productionDatabase}.`,
		`- devapi customer-sandbox status: ${developerContract.sandbox.devapiCustomerSandboxStatus}`,
		'',
		'## Full REST inventory',
		`The served OpenAPI currently contains ${operations.length} HTTP operations. Read GET /v1/agent/openapi or GET /llms-full.txt for the generated list.`,
		'',
	].join('\n')}\n`
}

export function buildLlmsFullTxt(spec: JsonObject = PUBLIC_AGENT_OPENAPI): string {
	const operations = listAgentRestOperations(spec)
	const lines = operations.map(
		(operation) =>
			`- ${operation.method} ${operation.absolutePath} — ${operation.summary} [auth=${operation.auth}; lifecycle=${operation.lifecycle}; operationId=${operation.operationId ?? 'none'}]`,
	)

	return `${[
		'# Suwappu Developer API — Generated Full REST Reference',
		'',
		'> Generated from the served public OpenAPI contract. If this file disagrees with GET /v1/agent/openapi, the OpenAPI contract is authoritative and CI should fail.',
		'',
		`REST compatibility major: ${developerContract.agentRest.compatibilityMajor}`,
		`OpenAPI revision: ${developerContract.agentRest.openapiRevision}`,
		'Chain support is runtime-discovered at GET /v1/agent/chains; no static chain count is part of this document.',
		'',
		`## REST operations (${operations.length})`,
		...lines,
		'',
		'## Non-REST protocol discovery',
		`- MCP runtime: ${developerContract.hostedProtocols.mcp.endpoint} — catalog authority=${developerContract.hostedProtocols.mcp.catalogAuthority}`,
		`- A2A Agent Card: ${developerContract.hostedProtocols.a2a.agentCard} — capability authority=${developerContract.hostedProtocols.a2a.capabilityAuthority}`,
		`- Developer contract: https://api.suwappu.bot/v1/developer-contract`,
		`- Retry contract: https://api.suwappu.bot/v1/retry-contracts`,
		`- Lifecycle registry: https://api.suwappu.bot/v1/api-lifecycle`,
		'',
	].join('\n')}\n`
}

export const MACHINE_DOC_QUICKSTART = Object.freeze({
	steps: QUICKSTART_STEPS,
	managedExecute: MANAGED_EXECUTE,
})
