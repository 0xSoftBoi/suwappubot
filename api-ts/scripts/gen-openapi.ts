#!/usr/bin/env bun
/**
 * gen-openapi.ts — MERGE-IN-PLACE OpenAPI generator.
 *
 * The checked-in `openapi-agent.json` remains the source for operation prose,
 * examples, response schemas, paths, and `components.responses`. Root contract
 * identity is NOT hand-authored: this generator derives the public production
 * server, compatibility wording and document revision from
 * `developer-contract.json`, then (re)derives request schemas from the runtime
 * Zod validators.
 *
 * This split prevents stale chain counts / development hosts from becoming a
 * competing machine-readable contract while preserving reviewed endpoint prose.
 *
 * Modes:
 *   (default)  write openapi-agent.json
 *   --check    generate in-memory and diff against disk; exit 1 if they differ
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
	CancelOrderSchema,
	CreatePolicySchema,
	ExecuteCommandSchema,
	ExecuteSwapSchema,
	PerpsQuoteSchema,
	PlaceOrderSchema,
	QuoteRequestSchema,
	RegisterAgentSchema,
	SimulateSwapSchema,
	SwapRequestSchema,
	TopupSchema,
	UpdateAgentSchema,
} from '../src/routes/validators'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const SPEC_PATH = join(__dirname, '..', 'openapi-agent.json')
export const DEVELOPER_CONTRACT_PATH = join(__dirname, '..', 'developer-contract.json')

type DeveloperContract = {
	agentRest: {
		compatibilityMajor: string
		basePath: string
		openapiRevision: string
		lifecycle: string
		discovery?: Record<string, string>
	}
}

function loadDeveloperContract(): DeveloperContract {
	const parsed = JSON.parse(readFileSync(DEVELOPER_CONTRACT_PATH, 'utf8')) as Partial<DeveloperContract>
	const agentRest = parsed.agentRest
	if (
		!agentRest ||
		typeof agentRest.compatibilityMajor !== 'string' ||
		typeof agentRest.basePath !== 'string' ||
		typeof agentRest.openapiRevision !== 'string' ||
		typeof agentRest.lifecycle !== 'string'
	) {
		throw new Error('developer-contract.json is missing required agentRest lifecycle/version fields')
	}
	if (!agentRest.basePath.startsWith(`/${agentRest.compatibilityMajor}/`)) {
		throw new Error(
			`developer-contract.json basePath ${agentRest.basePath} does not match compatibility major ${agentRest.compatibilityMajor}`,
		)
	}
	return parsed as DeveloperContract
}

const DEVELOPER_CONTRACT = loadDeveloperContract()
const SPEC_VERSION = DEVELOPER_CONTRACT.agentRest.openapiRevision
const PRODUCTION_SERVER = `https://api.suwappu.bot${DEVELOPER_CONTRACT.agentRest.basePath}`
const CONTRACT_DESCRIPTION = [
	'Cross-chain execution API for AI agents.',
	'Current chain support is runtime-discovered at GET /v1/agent/chains; do not embed a static chain count or list.',
	'Use quote and simulation before unsigned preparation, and treat managed execution as an explicit fund-moving authority escalation.',
	`REST compatibility major: ${DEVELOPER_CONTRACT.agentRest.compatibilityMajor}. OpenAPI document revision: ${SPEC_VERSION}.`,
].join(' ')

import { deepMerge, toJsonSchema as toSchema, type Json } from '../src/lib/zodJsonSchema'

/**
 * Re-apply human-written documentation from the existing schema object onto the
 * freshly generated one, ONLY where the generator did not already produce it.
 * Preserves top-level `description`/`example`/`examples` and per-property
 * `description`/`example`. Deterministic and idempotent.
 */
function preserveProse(generated: Json, existing: Json | undefined): Json {
	if (!existing || typeof existing !== 'object') return generated
	const out: Json = { ...generated }

	for (const key of ['description', 'example', 'examples'] as const) {
		if (out[key] === undefined && existing[key] !== undefined) {
			out[key] = existing[key]
		}
	}

	if (
		out.properties &&
		typeof out.properties === 'object' &&
		existing.properties &&
		typeof existing.properties === 'object'
	) {
		for (const prop of Object.keys(out.properties)) {
			const genProp = out.properties[prop]
			const exProp = existing.properties[prop]
			if (
				genProp &&
				typeof genProp === 'object' &&
				exProp &&
				typeof exProp === 'object'
			) {
				for (const key of ['description', 'example'] as const) {
					if (genProp[key] === undefined && exProp[key] !== undefined) {
						genProp[key] = exProp[key]
					}
				}
			}
		}
	}

	return out
}

/**
 * Map of `components.schemas` name -> Zod schema + manual overrides.
 *
 * `manualOverrides` re-add human-facing constraints that `z.toJSONSchema` drops
 * (notably every `.refine()`), and normalize representations to match the
 * hand-authored spec (e.g. `additionalProperties: true` for free-form metadata,
 * `oneOf` for the string|number amount).
 */
const SCHEMA_MAP: Record<
	string,
	{ schema: z.ZodTypeAny; manualOverrides?: Json }
> = {
	RegisterAgentRequest: {
		schema: RegisterAgentSchema,
		manualOverrides: {
			properties: {
				metadata: { additionalProperties: true },
				callback_url: {
					format: 'uri',
					description:
						'Public HTTPS URL for webhook delivery. Must be a public URL (no private/loopback/metadata hosts).',
				},
			},
		},
	},
	UpdateAgentRequest: {
		schema: UpdateAgentSchema,
		manualOverrides: {
			description: 'At least one field must be provided.',
			properties: {
				metadata: { additionalProperties: true },
				callback_url: {
					$dropKeys: ['anyOf'],
					type: 'string',
					format: 'uri',
					nullable: true,
					description:
						'Public webhook URL. Must be a public URL (no private/loopback/metadata hosts).',
				},
			},
		},
	},
	QuoteRequest: {
		schema: QuoteRequestSchema,
		manualOverrides: {
			properties: {
				amount: { description: 'Positive decimal string, max 1,000,000 units.' },
				wallet_address: {
					pattern: '^0x[0-9a-fA-F]{40}$',
					description:
						'EVM address (0x + 40 hex). Must not be the zero address. When provided, the response includes executable transaction data.',
				},
			},
		},
	},
	SwapRequest: {
		schema: SwapRequestSchema,
		manualOverrides: {
			properties: {
				quote_id: { description: 'A quote_id from POST /quote.' },
				wallet_address: { description: "Must be the agent's own managed wallet." },
			},
		},
	},
	SimulateSwapRequest: {
		schema: SimulateSwapSchema,
		manualOverrides: {
			description:
				'Provide quote_id to simulate a cached quote, or from_token + to_token + amount to fetch and simulate a fresh one.',
			properties: {
				quote_id: {
					description: 'A quote_id from POST /quote. Overrides from_token/to_token/amount if provided.',
				},
				amount: {
					description: 'Positive decimal string, max 1,000,000 units. Required unless quote_id is provided.',
				},
				wallet_address: {
					pattern: '^0x[0-9a-fA-F]{40}$',
					description:
						'EVM address (0x + 40 hex). Must not be the zero address. Strongly recommended — without it, balance/allowance/gas/eth_call checks are skipped (reported as warn/unavailable).',
				},
			},
		},
	},
	ExecuteSwapRequest: {
		schema: ExecuteSwapSchema,
		manualOverrides: {
			properties: { quote_id: { description: 'A quote_id from POST /quote.' } },
		},
	},
	ExecuteCommandRequest: {
		schema: ExecuteCommandSchema,
		manualOverrides: {
			properties: {
				command: {
					description: 'Natural language command (e.g. "swap 0.5 ETH to USDC on Base").',
				},
				wallet_address: { description: "When provided, must be the agent's own managed wallet." },
			},
		},
	},
	CreatePolicyRequest: {
		schema: CreatePolicySchema,
		manualOverrides: {
			properties: {
				params: {
					properties: {
						maxAmountWei: { description: 'Required for spending_limit. Max value in wei.' },
						timeWindowSeconds: { description: 'Time window for spending_limit.' },
						allowedAddresses: { description: 'Required for whitelist.' },
					},
				},
			},
		},
	},
	TopupRequest: {
		schema: TopupSchema,
		manualOverrides: {
			properties: {
				txHash: { description: 'On-chain USDC payment tx hash.' },
				chain: { default: 'base', description: 'Chain the payment was made on.' },
				amount: {
					$dropKeys: ['anyOf'],
					oneOf: [{ type: 'string' }, { type: 'number' }],
					description: 'USDC amount paid (string or number; coerced to a number).',
				},
			},
		},
	},
	PerpsQuoteRequest: {
		schema: PerpsQuoteSchema,
		manualOverrides: {
			description: 'Perp position quote request (Hyperliquid).',
			properties: {
				market: {
					description: 'Perp market symbol (e.g. ETH-USD). See GET /perps/markets.',
					example: 'ETH-USD',
				},
				side: { description: 'Position direction.' },
				size: { description: 'Position size in base units (positive).', example: 1 },
				leverage: {
					description:
						'Leverage multiplier (1 through the market maxLeverage returned by GET /perps/markets; current Suwappu ceiling is 20).',
					example: 5,
				},
			},
		},
	},
	PlaceOrderRequest: {
		schema: PlaceOrderSchema,
		manualOverrides: {
			description: 'Prediction-market limit order (Polymarket CLOB).',
			properties: {
				tokenId: { description: 'CLOB token id for the outcome. See GET /predict/market/{id}.' },
				price: { description: 'Decimal string between 0 and 1.', example: '0.62' },
				size: { description: 'Positive decimal string (number of shares).', example: '10' },
				side: { description: 'Order direction.' },
			},
		},
	},
	CancelOrderRequest: {
		schema: CancelOrderSchema,
		manualOverrides: {
			description: 'Cancel a prediction-market order by id.',
			properties: { orderId: { description: 'The CLOB order id to cancel.' } },
		},
	},
}

/** Build the regenerated spec object from the existing one (pure; no IO besides the passed-in spec). */
export function buildSpec(existing: Json): Json {
	const spec: Json = JSON.parse(JSON.stringify(existing))

	// Root machine-contract identity is derived. This deliberately overwrites
	// stale human prose / environment lists from older artifacts.
	spec.openapi = '3.1.0'
	spec.info = spec.info ?? {}
	spec.info.title = 'Suwappu Agent API'
	spec.info.description = CONTRACT_DESCRIPTION
	spec.info.version = SPEC_VERSION
	spec.servers = [{ url: PRODUCTION_SERVER, description: 'Production' }]
	spec['x-suwappu-rest-compatibility-major'] = DEVELOPER_CONTRACT.agentRest.compatibilityMajor
	spec['x-suwappu-lifecycle'] = DEVELOPER_CONTRACT.agentRest.lifecycle
	spec['x-suwappu-chain-discovery'] = 'GET /v1/agent/chains'
	spec['x-suwappu-developer-contract'] = 'GET /v1/developer-contract'

	spec.components = spec.components ?? {}
	spec.components.schemas = spec.components.schemas ?? {}

	for (const [name, { schema, manualOverrides }] of Object.entries(SCHEMA_MAP)) {
		const generated = toSchema(schema)
		const merged = manualOverrides ? deepMerge(generated, manualOverrides) : generated
		const withProse = preserveProse(merged, spec.components.schemas[name])
		spec.components.schemas[name] = withProse
	}

	return spec
}

/** Stable JSON serialization: preserves object key insertion order (deterministic —
 * no timestamps, no non-deterministic iteration), 2-space indent, trailing newline. */
export function serialize(obj: Json): string {
	return `${JSON.stringify(obj, null, 2)}\n`
}

function main(): void {
	const check = process.argv.includes('--check')
	const onDisk = readFileSync(SPEC_PATH, 'utf8')
	const existing = JSON.parse(onDisk)
	const next = serialize(buildSpec(existing))

	if (check) {
		if (next !== onDisk) {
			console.error(
				'❌ openapi-agent.json is out of date with the Zod validators or developer contract.\n' +
					'   Run `bun run generate:openapi` and commit the result.',
			)
			process.exit(1)
		}
		console.log('✓ openapi-agent.json is in sync with the Zod validators and developer contract.')
		return
	}

	writeFileSync(SPEC_PATH, next)
	console.log(
		`✓ Wrote ${SPEC_PATH} (REST ${DEVELOPER_CONTRACT.agentRest.compatibilityMajor}, OpenAPI revision ${SPEC_VERSION}).`,
	)
}

if (import.meta.main) {
	main()
}
