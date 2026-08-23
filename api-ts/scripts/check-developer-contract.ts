#!/usr/bin/env bun
/**
 * check-developer-contract.ts
 *
 * Enforces developer-platform facts that can already be derived mechanically.
 * This is intentionally narrower than the target state in #873: OpenAPI prose and
 * llms endpoint inventories are still partly hand-authored, so this guard blocks
 * known high-risk contradictions while the full generator is implemented.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(API_ROOT, '..')

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T
}

function invariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Developer contract violation: ${message}`)
}

type DeveloperContract = {
	agentRest: {
		compatibilityMajor: string
		basePath: string
		openapiRevision: string
		lifecycle: string
	}
	sandbox: {
		kind: string
		endpoint: string
		realFunds: boolean
		liveQuotes: boolean
		providerCalls: boolean
		rpcCalls: boolean
		signing: boolean
		broadcast: boolean
		billing: boolean
		productionDatabase: boolean
		persistence: string
		devapiCustomerSandboxStatus: string
		policy: string
	}
	packages: {
		typescriptSdk: {
			name: string
			publication: string
			compatibleApiMajors: string[]
		}
		mcpBridge: {
			name: string
			publication: string
			catalogAuthority: string
		}
		pythonSdk: {
			publication: string
			productionInstall: string
			compatibleApiMajors: string[]
		}
	}
	policies: Record<string, string>
}

type OpenApiDoc = {
	info?: { version?: string }
	servers?: Array<{ url?: string; description?: string }>
}

type PackageJson = {
	name?: string
	version?: string
	suwappu?: {
		supportStage?: string
		compatibleApiMajors?: string[]
		apiBasePath?: string
		bridgeType?: string
		catalogAuthority?: string
		hostedEndpoint?: string
		compatibilityPolicy?: string
	}
}

const contractPath = join(API_ROOT, 'developer-contract.json')
const openApiPath = join(API_ROOT, 'openapi-agent.json')
const appPath = join(API_ROOT, 'src', 'app.ts')
const sandboxPath = join(API_ROOT, 'src', 'routes', 'sandbox.ts')
const healthPath = join(API_ROOT, 'src', 'routes', 'health.ts')
const sdkPackagePath = join(REPO_ROOT, 'packages', 'sdk', 'package.json')
const mcpPackagePath = join(REPO_ROOT, 'packages', 'mcp-server', 'package.json')

const contract = readJson<DeveloperContract>(contractPath)
const openApi = readJson<OpenApiDoc>(openApiPath)
const sdkPackage = readJson<PackageJson>(sdkPackagePath)
const mcpPackage = readJson<PackageJson>(mcpPackagePath)
const appSource = readFileSync(appPath, 'utf8')
const sandboxSource = readFileSync(sandboxPath, 'utf8')
const healthSource = readFileSync(healthPath, 'utf8')

const { agentRest } = contract
invariant(agentRest.compatibilityMajor.length > 0, 'Agent REST compatibility major is empty')
invariant(
	agentRest.basePath.startsWith(`/${agentRest.compatibilityMajor}/`),
	`${agentRest.basePath} does not match compatibility major ${agentRest.compatibilityMajor}`,
)
invariant(agentRest.lifecycle.length > 0, 'Agent REST lifecycle is empty')
invariant(
	openApi.info?.version === agentRest.openapiRevision,
	`OpenAPI info.version ${openApi.info?.version ?? '<missing>'} != developer contract revision ${agentRest.openapiRevision}`,
)

const productionServer = `https://api.suwappu.bot${agentRest.basePath}`
invariant(
	openApi.servers?.some((server) => server.url === productionServer),
	`OpenAPI servers do not contain canonical production server ${productionServer}`,
)

// The namespaced contract sandbox is deliberately much narrower than a full
// customer sandbox environment. These negative capabilities are safety
// invariants: changing any one to true requires a separate reviewed design.
const sandbox = contract.sandbox
invariant(sandbox.kind === 'deterministic-contract-simulator', 'sandbox kind must stay deterministic-contract-simulator')
invariant(sandbox.endpoint === 'https://api.suwappu.bot/v1/sandbox', 'sandbox endpoint changed without contract update')
invariant(sandbox.realFunds === false, 'contract sandbox must never claim real funds')
invariant(sandbox.liveQuotes === false, 'contract sandbox must never call live quotes')
invariant(sandbox.providerCalls === false, 'contract sandbox must never call routing providers')
invariant(sandbox.rpcCalls === false, 'contract sandbox must never call chain RPCs')
invariant(sandbox.signing === false, 'contract sandbox must never sign')
invariant(sandbox.broadcast === false, 'contract sandbox must never broadcast')
invariant(sandbox.billing === false, 'contract sandbox must never charge or meter')
invariant(sandbox.productionDatabase === false, 'contract sandbox must never use production databases')
invariant(sandbox.persistence === 'ephemeral-in-memory', 'sandbox persistence semantics changed without review')
invariant(
	sandbox.devapiCustomerSandboxStatus === 'unverified-do-not-assume-isolated',
	'devapi must not be promoted to customer-sandbox status without #874 evidence',
)
invariant(healthSource.includes("route('/v1/sandbox', sandboxRoutes)"), 'contract sandbox is not mounted at /v1/sandbox')

for (const forbidden of [
	"from '../services'",
	"from '../db'",
	'EnvService',
	'Turnkey',
	'SwapService',
	'Jupiter',
	'Li.Fi',
	'fetch(',
	'INTERNAL_API',
	'AGENT_METERING',
]) {
	invariant(!sandboxSource.includes(forbidden), `sandbox source contains forbidden production dependency marker: ${forbidden}`)
}

invariant(
	sdkPackage.name === contract.packages.typescriptSdk.name,
	`TypeScript SDK package name ${sdkPackage.name ?? '<missing>'} != ${contract.packages.typescriptSdk.name}`,
)
invariant(
	contract.packages.typescriptSdk.compatibleApiMajors.includes(agentRest.compatibilityMajor),
	`TypeScript SDK contract does not declare compatibility with REST ${agentRest.compatibilityMajor}`,
)
invariant(sdkPackage.suwappu?.supportStage === 'active', 'TypeScript SDK package must declare active support stage')
invariant(
	sdkPackage.suwappu?.compatibleApiMajors?.includes(agentRest.compatibilityMajor),
	`TypeScript SDK package metadata does not declare compatibility with REST ${agentRest.compatibilityMajor}`,
)
invariant(
	sdkPackage.suwappu?.apiBasePath === agentRest.basePath,
	`TypeScript SDK package apiBasePath ${sdkPackage.suwappu?.apiBasePath ?? '<missing>'} != ${agentRest.basePath}`,
)
invariant(
	typeof sdkPackage.suwappu?.compatibilityPolicy === 'string' && sdkPackage.suwappu.compatibilityPolicy.length > 0,
	'TypeScript SDK package must link its compatibility policy',
)

invariant(
	mcpPackage.name === contract.packages.mcpBridge.name,
	`MCP bridge package name ${mcpPackage.name ?? '<missing>'} != ${contract.packages.mcpBridge.name}`,
)
invariant(
	contract.packages.mcpBridge.catalogAuthority === 'hosted-mcp-runtime',
	'MCP bridge contract must not claim package-version authority over the hosted tool catalog',
)
invariant(mcpPackage.suwappu?.supportStage === 'active', 'MCP bridge package must declare active support stage')
invariant(
	mcpPackage.suwappu?.bridgeType === 'stdio-to-hosted-runtime',
	'MCP bridge package must identify itself as a bridge to the hosted runtime',
)
invariant(
	mcpPackage.suwappu?.catalogAuthority === contract.packages.mcpBridge.catalogAuthority,
	'MCP bridge package catalog authority disagrees with developer contract',
)
invariant(
	mcpPackage.suwappu?.hostedEndpoint === 'https://api.suwappu.bot/mcp',
	'MCP bridge package must identify the canonical hosted MCP endpoint',
)

invariant(contract.packages.pythonSdk.publication === 'source-only', 'Python SDK must remain source-only until publication is verified')
invariant(
	contract.packages.pythonSdk.productionInstall === 'pin-full-commit-sha',
	'Source-only Python SDK must require a full commit SHA for production installs',
)
invariant(
	contract.packages.pythonSdk.compatibleApiMajors.includes(agentRest.compatibilityMajor),
	`Python SDK source contract does not declare compatibility with REST ${agentRest.compatibilityMajor}`,
)

for (const [name, relativePath] of Object.entries(contract.policies)) {
	const policyPath = resolve(API_ROOT, relativePath)
	invariant(existsSync(policyPath), `Policy ${name} points to missing file ${relativePath}`)
}

const sandboxPolicyPath = resolve(API_ROOT, sandbox.policy)
invariant(existsSync(sandboxPolicyPath), `Sandbox policy points to missing file ${sandbox.policy}`)

const forbiddenMachineClaims: Array<[RegExp, string]> = [
	[/across 40\+ chains/i, 'llms/plugin copy must not publish a stale static Agent API chain count'],
	[/across 7 blockchain networks/i, 'AI plugin copy must not publish a stale static chain list'],
	[/PyPI:\s*suwappu/i, 'machine docs must not claim a Python registry release while the SDK is source-only'],
]

for (const [pattern, message] of forbiddenMachineClaims) {
	invariant(!pattern.test(appSource), message)
}

invariant(appSource.includes('GET /v1/agent/chains'), 'machine-facing copy must point at runtime chain discovery')
invariant(appSource.includes('Quick Start — least privilege first'), 'llms quickstart must preserve the least-privilege onboarding contract')
invariant(appSource.includes('Managed execution can move funds'), 'llms copy must explicitly distinguish managed execution authority')

console.log(
	`✓ Developer contract valid: REST ${agentRest.compatibilityMajor}, OpenAPI ${agentRest.openapiRevision}, ` +
		`SDK ${sdkPackage.version ?? 'unknown'}, MCP bridge ${mcpPackage.version ?? 'unknown'}, sandbox no-funds boundary enforced.`,
)
