/**
 * ETDI-style tool-definition integrity check for MCP money-path tools.
 *
 * Rationale (arXiv 2506.01333, "ETDI: OAuth-Enhanced Tool Definitions for
 * MCP"): unsigned, mutable tool definitions let a compromised deploy (or a
 * bug that silently loosens a Zod schema) widen what a client believes it is
 * calling without the client ever finding out — the classic "tool
 * squatting / rug-pull" scenario the paper describes for MCP catalogues.
 *
 * We can't do OAuth-scoped capability tokens without a client-side registry
 * to match, but we CAN pin the exact {name, description, inputSchema} shape
 * of our own money-path tools to a checked-in hash and refuse to dispatch a
 * call if the live definition drifts from it. This turns an accidental (or
 * malicious) schema change on `execute_swap` into a hard startup-detectable
 * refusal instead of a silent behavior change.
 *
 * This is intentionally NOT a general crypto-signing scheme — it is a cheap,
 * dependency-free tripwire: hash what we ship, compare it to what we
 * intended to ship, refuse on mismatch. Regenerate the constant deliberately
 * (never reflexively) via `bun run scripts/print-tool-hashes.ts` whenever
 * execute_swap's schema or description intentionally changes.
 */
import { createHash } from 'node:crypto'

export type ToolDefinitionLike = {
	name: string
	description: string
	inputSchema: unknown
}

/**
 * Recursively sort object keys so the JSON serialization is stable
 * regardless of property insertion order (Zod / z.toJSONSchema output order
 * is not a contract we want to depend on).
 */
function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize)
	if (value !== null && typeof value === 'object') {
		const out: Record<string, unknown> = {}
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = canonicalize((value as Record<string, unknown>)[key])
		}
		return out
	}
	return value
}

/** Stable SHA-256 hex digest over a tool's {name, description, inputSchema}. */
export function computeToolDefinitionHash(tool: ToolDefinitionLike): string {
	const canonical = canonicalize({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	})
	return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/**
 * Money-path tools whose definitions are pinned. execute_swap is the only
 * MCP tool that produces a transaction a caller can sign and broadcast; add
 * a tool here (and regenerate the hash below) only when it gains the same
 * property.
 */
export const MONEY_PATH_TOOL_NAMES = new Set<string>(['execute_swap'])

/**
 * Expected hashes for money-path tool definitions, checked in deliberately.
 *
 * Regenerate with: `bun run scripts/print-tool-hashes.ts`
 * Only paste in a new hash here as part of a commit that intentionally
 * changes the tool's description or inputSchema — never to silence a
 * mismatch you don't understand.
 */
export const EXPECTED_TOOL_DEFINITION_HASHES: Record<string, string> = {
	execute_swap: '94a4bf2021ee909900424360d0c80b3067e21ed635dfbb0389d3d60cf1a1d7ac',
}

/**
 * Verify every money-path tool definition against its pinned hash. Computed
 * once at module load against the live TOOLS array (see mcpTools.ts) so a
 * runtime mutation or a source change that forgot to regenerate the constant
 * is caught before the server ever accepts a call — not lazily on first
 * request.
 *
 * Returns the set of money-path tool names that FAILED verification (empty
 * = all good). A tool missing from `tools` entirely also counts as failed —
 * dispatch code must never silently skip the check because a name lookup
 * came back undefined.
 */
export function verifyMoneyPathToolIntegrity(tools: readonly ToolDefinitionLike[]): Set<string> {
	const failed = new Set<string>()
	for (const name of MONEY_PATH_TOOL_NAMES) {
		const expected = EXPECTED_TOOL_DEFINITION_HASHES[name]
		const tool = tools.find((t) => t.name === name)
		if (!expected || !tool || computeToolDefinitionHash(tool) !== expected) {
			failed.add(name)
		}
	}
	return failed
}
