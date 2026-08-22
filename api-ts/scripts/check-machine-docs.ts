#!/usr/bin/env bun

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import aiCatalog from '../ai-catalog.json'
import developerContract from '../developer-contract.json'
import rawOpenApi from '../openapi-agent.json'
import { buildLlmsFullTxt, buildLlmsTxt, listAgentRestOperations } from '../src/lib/machineDocs'
import { PUBLIC_AGENT_OPENAPI } from '../src/lib/publicOpenApi'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API_ROOT = resolve(__dirname, '..')
const appSource = readFileSync(join(API_ROOT, 'src', 'app.ts'), 'utf8')

function invariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Machine-doc contract violation: ${message}`)
}

const shortDoc = buildLlmsTxt()
const fullDoc = buildLlmsFullTxt()
const operations = listAgentRestOperations()

const forbiddenStaticClaims: Array<[RegExp, string]> = [
	[/\b\d+\+\s+chains\b/i, 'static “N+ chains” claim'],
	[/\bacross\s+\d+\s+blockchain\s+networks\b/i, 'static blockchain-network total'],
	[/PyPI:\s*suwappu/i, 'unverified Python registry publication'],
	[/devapi\.suwappu\.bot/i, 'unverified devapi customer environment'],
]

for (const [pattern, label] of forbiddenStaticClaims) {
	invariant(!pattern.test(shortDoc), `generated llms.txt contains ${label}`)
	invariant(!pattern.test(fullDoc), `generated llms-full.txt contains ${label}`)
}

invariant(!appSource.includes("app.get('/llms.txt'"), 'app.ts must not own a second llms.txt route')
invariant(!appSource.includes("app.get('/llms-full.txt'"), 'app.ts must not own a second llms-full.txt route')
invariant(!appSource.includes('MCP_TOOLS'), 'app.ts must not rebuild the MCP inventory for machine docs')

// The committed OpenAPI artifact is now canonicalized by gen-openapi.ts, not
// merely cleaned at serve time. This catches stale root prose/environment data.
const rawDescription = String((rawOpenApi as any).info?.description ?? '')
for (const [pattern, label] of forbiddenStaticClaims) {
	invariant(!pattern.test(rawDescription), `openapi-agent.json description contains ${label}`)
}
invariant(
	Array.isArray((rawOpenApi as any).servers) &&
		(rawOpenApi as any).servers.length === 1 &&
		(rawOpenApi as any).servers[0]?.url === `https://api.suwappu.bot${developerContract.agentRest.basePath}`,
	'openapi-agent.json must advertise only the verified production server',
)
invariant(
	(rawOpenApi as any).info?.version === developerContract.agentRest.openapiRevision,
	'raw OpenAPI revision must equal developer-contract.json',
)

// Generated full machine docs must be a lossless REST inventory of the served
// OpenAPI: exactly one generated line per HTTP operation.
for (const operation of operations) {
	const needle = `- ${operation.method} ${operation.absolutePath} —`
	const occurrences = fullDoc.split(needle).length - 1
	invariant(occurrences === 1, `${needle} occurs ${occurrences} times in llms-full.txt`)
}
const generatedRestLines = fullDoc
	.split('\n')
	.filter((line) => /^- (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) \/v1\/agent(?:\/|\b)/.test(line))
invariant(
	generatedRestLines.length === operations.length,
	`llms-full REST operation count ${generatedRestLines.length} != OpenAPI operation count ${operations.length}`,
)

// Discovery URLs in the AI catalog must resolve to canonical machine-contract
// endpoints and must not contain static topology totals.
const catalogText = JSON.stringify(aiCatalog)
for (const [pattern, label] of forbiddenStaticClaims) {
	invariant(!pattern.test(catalogText), `ai-catalog.json contains ${label}`)
}
const resourceUrls = new Set((aiCatalog.resources ?? []).map((resource: any) => resource.url))
invariant(resourceUrls.has('https://api.suwappu.bot/v1/agent/openapi'), 'AI catalog missing canonical OpenAPI URL')
invariant(resourceUrls.has('https://api.suwappu.bot/v1/developer-contract'), 'AI catalog missing developer contract')
invariant(resourceUrls.has('https://api.suwappu.bot/llms.txt'), 'AI catalog missing generated llms.txt')
invariant(resourceUrls.has('https://api.suwappu.bot/llms-full.txt'), 'AI catalog missing generated llms-full.txt')

// Served public OpenAPI must agree with the contract and never reintroduce a
// second environment or static topology claim.
invariant(PUBLIC_AGENT_OPENAPI.servers.length === 1, 'served OpenAPI must expose one verified server')
invariant(
	PUBLIC_AGENT_OPENAPI.servers[0]?.url === `https://api.suwappu.bot${developerContract.agentRest.basePath}`,
	'served OpenAPI server differs from developer contract',
)
invariant(
	PUBLIC_AGENT_OPENAPI.info.version === developerContract.agentRest.openapiRevision,
	'served OpenAPI revision differs from developer contract',
)
invariant(
	shortDoc.includes('Chain support: runtime-discovered'),
	'llms.txt must tell clients chain support is runtime-discovered',
)
invariant(
	fullDoc.includes('Chain support is runtime-discovered at GET /v1/agent/chains'),
	'llms-full.txt must point at runtime chain discovery',
)

console.log(
	`✓ Machine docs derive from public contracts: ${operations.length} REST operations, no static chain/package/environment drift.`,
)
