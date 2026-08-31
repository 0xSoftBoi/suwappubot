#!/usr/bin/env bun
/**
 * print-tool-hashes.ts — print the current ETDI-style integrity hash for
 * every MCP tool definition, highlighting the money-path tools whose hash is
 * pinned in src/lib/toolIntegrity.ts (EXPECTED_TOOL_DEFINITION_HASHES).
 *
 * Use this to DELIBERATELY regenerate the pinned constant after an
 * intentional change to a money-path tool's description or inputSchema
 * (e.g. execute_swap). Copy the printed hash for that tool into
 * EXPECTED_TOOL_DEFINITION_HASHES as part of the SAME commit that changed
 * the tool, so a reviewer sees both together.
 *
 * Do NOT run this reflexively to "fix" a CI/startup integrity failure —
 * that failure means the live definition drifted from what was reviewed and
 * intended. Only paste in a new hash once you've confirmed the drift is the
 * change you meant to make.
 *
 * Usage: bun run scripts/print-tool-hashes.ts
 */
import { TOOLS } from '../src/routes/mcpTools'
import { computeToolDefinitionHash, MONEY_PATH_TOOL_NAMES, EXPECTED_TOOL_DEFINITION_HASHES } from '../src/lib/toolIntegrity'

function main() {
	console.log(`Tool-definition integrity hashes (${TOOLS.length} tools):\n`)
	for (const tool of TOOLS) {
		const hash = computeToolDefinitionHash(tool)
		const isMoneyPath = MONEY_PATH_TOOL_NAMES.has(tool.name)
		const expected = EXPECTED_TOOL_DEFINITION_HASHES[tool.name]
		const marker = isMoneyPath ? (hash === expected ? '[MONEY-PATH, pinned, MATCHES]' : '[MONEY-PATH, pinned, *** MISMATCH ***]') : ''
		console.log(`  ${tool.name.padEnd(24)} ${hash} ${marker}`)
	}
	console.log('\nTo pin/update a money-path tool, copy its hash into EXPECTED_TOOL_DEFINITION_HASHES in src/lib/toolIntegrity.ts.')
}

main()
