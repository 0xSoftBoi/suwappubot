#!/usr/bin/env bun
/**
 * gen-openapi.ts — MERGE-IN-PLACE OpenAPI generator.
 *
 * The hand-authored `openapi-agent.json` is the source of truth for all prose,
 * examples, response schemas, paths, and `components.responses`. This generator's
 * ONLY job is to (re)derive the REQUEST-schema bodies under `components.schemas`
 * from the Zod validators in `src/routes/validators.ts`, so the documented request
 * shapes can never drift from runtime validation.
 *
 * It reads the existing spec, overwrites the mapped request schemas with output
 * from `z.toJSONSchema(...)` (plus deterministic manual overrides for constraints
 * that Zod's JSON-Schema export drops, e.g. `.refine()`), preserves any
 * human-written descriptions/examples the generator can't derive, bumps the spec
 * version, and writes the result back with stable key ordering.
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

const SPEC_VERSION = '0.5.0'

// deno-lint-ignore no-explicit-any
type Json = any

/** Convert a Zod schema to a draft-7 JSON Schema object, stripping the `$schema` key. */
function toSchema(schema: z.ZodTypeAny): Json {
	const out = z.toJSONSchema(schema, {
		unrepresentable: 'any',
		io: 'input',
		target: 'draft-7',
	}) as Json
	delete out.$schema
	return out
}

/** Recursive deterministic deep-merge: `override` wins; objects merge, everything else replaces. */
function deepMerge(base: Json, override: Json): Json {
	if (
		override === null ||
		typeof override !== 'object' ||
		Array.isArray(override)
	) {
		return override
	}
	const out: Json = Array.isArray(base) ? [...base] : { ...(base ?? {}) }
	// `$dropKeys: [...]` is a directive (not emitted) that deletes generated keys
	// before the rest of the override is applied — used to collapse Zod unions
	// (anyOf) back to the hand-authored representation.
	if (Array.isArray(override.$dropKeys)) {
		for (const k of override.$dropKeys) delete out[k]
	}
	for (const key of Object.keys(override)) {
		if (key === '$dropKeys') continue
		const b = (out as Json)[key]
		const o = override[key]
		if (
			b &&
			typeof b === 'object' &&
			!Array.isArray(b) &&
			o &&
			typeof o === 'object' &&
			!Array.isArray(o)
		) {
			out[key] = deepMerge(b, o)
		} else {
			out[key] = o
		}
	}
	return out
}

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
				// callbackUrlSchema .refine() dropped — re-state the SSRF constraint.
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
			// .refine() (at-least-one-field) dropped — re-state it.
			description: 'At least one field must be provided.',
			properties: {
				metadata: { additionalProperties: true },
				// .nullish() generates an `anyOf` of [string, null]; collapse it back to the
				// hand-authored nullable-string + uri format (drop the generated `anyOf`).
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
				// tokenAmountSchema .refine() dropped.
				amount: {
					description: 'Positive decimal string, max 1,000,000 units.',
				},
				// evmAddressSchema .refine() (zero-address) dropped — re-state pattern + note.
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
				quote_id: {
					description: 'A quote_id from POST /quote.',
				},
				wallet_address: {
					description: "Must be the agent's own managed wallet.",
				},
			},
		},
	},
	SimulateSwapRequest: {
		schema: SimulateSwapSchema,
		manualOverrides: {
			// .refine() (quote_id OR from/to/amount) dropped — re-state it.
			description: 'Provide quote_id to simulate a cached quote, or from_token + to_token + amount to fetch and simulate a fresh one.',
			properties: {
				quote_id: { description: 'A quote_id from POST /quote. Overrides from_token/to_token/amount if provided.' },
				amount: { description: 'Positive decimal string, max 1,000,000 units. Required unless quote_id is provided.' },
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
			properties: {
				quote_id: { description: 'A quote_id from POST /quote.' },
			},
		},
	},
	ExecuteCommandRequest: {
		schema: ExecuteCommandSchema,
		manualOverrides: {
			properties: {
				command: {
					description:
						'Natural language command (e.g. "swap 0.5 ETH to USDC on Base").',
				},
				wallet_address: {
					description: "When provided, must be the agent's own managed wallet.",
				},
			},
		},
	},
	CreatePolicyRequest: {
		schema: CreatePolicySchema,
		manualOverrides: {
			properties: {
				params: {
					properties: {
						maxAmountWei: {
							description: 'Required for spending_limit. Max value in wei.',
						},
						timeWindowSeconds: {
							description: 'Time window for spending_limit.',
						},
						allowedAddresses: {
							description: 'Required for whitelist.',
						},
					},
				},
			},
		},
	},
	TopupRequest: {
		schema: TopupSchema,
		manualOverrides: {
			properties: {
				txHash: {
					description: 'On-chain USDC payment tx hash.',
				},
				chain: {
					default: 'base',
					description: 'Chain the payment was made on.',
				},
				// .transform(Number) dropped on input side — present as oneOf and note coercion.
				// `dropKeys` strips the generated `anyOf` so we don't carry a duplicate union.
				amount: {
					$dropKeys: ['anyOf'],
					oneOf: [{ type: 'string' }, { type: 'number' }],
					description:
						'USDC amount paid (string or number; coerced to a number).',
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
				leverage: { description: 'Leverage multiplier (1-20).', example: 5 },
			},
		},
	},
	PlaceOrderRequest: {
		schema: PlaceOrderSchema,
		manualOverrides: {
			description: 'Prediction-market limit order (Polymarket CLOB).',
			properties: {
				tokenId: {
					description: 'CLOB token id for the outcome. See GET /predict/market/{id}.',
				},
				// .refine() dropped on price/size.
				price: { description: 'Decimal string between 0 and 1.', example: '0.62' },
				size: { description: 'Positive decimal string (number of shares).', example: '10' },
				side: { description: 'Order direction.' },
				feeRateBps: { description: 'Optional fee rate in basis points (0-500).' },
			},
		},
	},
	CancelOrderRequest: {
		schema: CancelOrderSchema,
		manualOverrides: {
			description: 'Cancel a prediction-market order by id.',
			properties: {
				orderId: { description: 'The CLOB order id to cancel.' },
			},
		},
	},
}

/** Build the regenerated spec object from the existing one (pure; no IO besides the passed-in spec). */
export function buildSpec(existing: Json): Json {
	// Deep clone so we never mutate the parsed input.
	const spec: Json = JSON.parse(JSON.stringify(existing))

	spec.info = spec.info ?? {}
	spec.info.version = SPEC_VERSION

	spec.components = spec.components ?? {}
	spec.components.schemas = spec.components.schemas ?? {}

	for (const [name, { schema, manualOverrides }] of Object.entries(SCHEMA_MAP)) {
		const generated = toSchema(schema)
		const merged = manualOverrides
			? deepMerge(generated, manualOverrides)
			: generated
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
				'❌ openapi-agent.json is out of date with the Zod validators.\n' +
					'   Run `bun run generate:openapi` and commit the result.',
			)
			process.exit(1)
		}
		console.log('✓ openapi-agent.json is in sync with the Zod validators.')
		return
	}

	writeFileSync(SPEC_PATH, next)
	console.log(`✓ Wrote ${SPEC_PATH} (version ${SPEC_VERSION}).`)
}

// Only run when executed directly (`bun run scripts/gen-openapi.ts`), not when
// imported by other tooling (e.g. scripts/check-openapi.ts) for its exports.
if (import.meta.main) {
	main()
}
