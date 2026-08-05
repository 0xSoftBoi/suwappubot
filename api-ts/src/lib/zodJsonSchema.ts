/**
 * Zod -> JSON Schema, shared by every surface that publishes a contract.
 *
 * `src/routes/validators.ts` is the single source of truth for what the API
 * actually accepts. Anything that *describes* that contract to the outside
 * world — the OpenAPI spec (`scripts/gen-openapi.ts`) and the MCP tool
 * catalogue (`src/routes/mcp.ts`) — derives from it through here, so a
 * published schema cannot drift from the validation that runs.
 *
 * Extracted from gen-openapi.ts verbatim; behaviour is unchanged.
 */
import { z } from 'zod'

// deno-lint-ignore no-explicit-any
export type Json = any

/**
 * Convert a Zod schema to a draft-7 JSON Schema object, stripping `$schema`.
 *
 * NOTE: `z.toJSONSchema` cannot represent `.refine()` — every refinement is
 * silently dropped. Constraints that live in a refinement (amount caps, address
 * formats, at-least-one-field rules) MUST be re-stated as manual overrides by
 * the caller, or agents will be told a field is less constrained than it is.
 */
export function toJsonSchema(schema: z.ZodTypeAny): Json {
	const out = z.toJSONSchema(schema, {
		unrepresentable: 'any',
		io: 'input',
		target: 'draft-7',
	}) as Json
	delete out.$schema
	return out
}

/**
 * Same, but in `output` mode — what the caller receives rather than what it
 * sends. The distinction matters for `.default()` and transforms, where the
 * input is optional but the output is always present.
 */
export function toOutputJsonSchema(schema: z.ZodTypeAny): Json {
	const out = z.toJSONSchema(schema, {
		unrepresentable: 'any',
		io: 'output',
		target: 'draft-7',
	}) as Json
	delete out.$schema
	return out
}

/** Recursive deterministic deep-merge: `override` wins; objects merge, everything else replaces. */
export function deepMerge(base: Json, override: Json): Json {
	if (override === null || typeof override !== 'object' || Array.isArray(override)) {
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
		if (b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object' && !Array.isArray(o)) {
			out[key] = deepMerge(b, o)
		} else {
			out[key] = o
		}
	}
	return out
}

/**
 * Build an MCP `inputSchema` from the Zod schema the route validates with.
 *
 * `descriptions` maps property name -> agent-facing prose. Descriptions are
 * kept separate from `overrides` because they are the common case and carry no
 * semantics; per Anthropic's tool-design guidance they are also the highest-
 * leverage text in the whole catalogue, so losing them while gaining
 * constraints would be a bad trade.
 */
export function mcpInputSchema(
	schema: z.ZodTypeAny,
	descriptions: Record<string, string> = {},
	overrides: Json = {},
): Json {
	const derived = toJsonSchema(schema)
	const withDescriptions = deepMerge(derived, {
		properties: Object.fromEntries(
			Object.entries(descriptions).map(([prop, description]) => [prop, { description }]),
		),
	})
	return deepMerge(withDescriptions, overrides)
}
