/**
 * AEGIS observe-mode scanner hook -- Phase 3 of docs/plans/aegis-fork-extend.md.
 *
 * Thin, fail-open wrapper around `../aegis`'s pure `scan()`. OBSERVE MODE
 * ONLY: never blocks, never alters the response, never throws. Mirrors the
 * Python `bot/services/aegis_service.py` contract for the api-ts agent
 * surfaces (REST /execute, A2A message/send, MCP tools/call).
 *
 * Detections are logged at WARNING via the shared pino logger so they show
 * up in Railway's retained logs (this middleware has no telemetry sink of
 * its own -- Phase 3 doesn't add one).
 */

import { scan, type ScanOptions } from '../aegis'
import { logger } from '../lib/logger'

export interface AegisScanContext {
	/** Where the text came from -- e.g. "agent_execute", "a2a_message_send", "mcp_tools_call". */
	source: string
	/** Agent id, if known, for correlating detections to a specific caller.
	 * `number` in api-ts (the agents table PK); kept union-typed for callers
	 * that already hold a string id. */
	agentId?: string | number
	/** MCP-only: which tool was being called. */
	tool?: string
}

/**
 * Scan `text` and log a structured warning if it looks like a threat.
 * Never blocks and never throws -- a scanner failure degrades to "no threat
 * detected" and is logged at debug level, exactly like the Python service's
 * fail-open contract.
 *
 * Intentionally synchronous and fire-and-forget from the caller's
 * perspective: call this after validating input and BEFORE any billing/
 * metering step, but do not gate the response on its result.
 */
export function scanForThreatsObserveOnly(
	text: string | undefined | null,
	context: AegisScanContext,
	options?: ScanOptions,
): void {
	if (!text) return

	try {
		const verdict = scan(text, options)
		if (verdict.isThreat) {
			logger.warn(
				{
					aegis: true,
					mode: 'observe',
					source: context.source,
					agentId: context.agentId ?? null,
					tool: context.tool ?? null,
					score: verdict.score,
					signatureIds: verdict.signatureIds,
					categories: verdict.categories,
				},
				'AEGIS threat detected (observe mode -- not blocked)',
			)
		}
	} catch (err) {
		// Fail-open: a scanner bug must never break the request it was
		// trying to observe.
		logger.debug(
			{ aegis: true, source: context.source, err: err instanceof Error ? err.message : String(err) },
			'AEGIS scan failed (fail-open)',
		)
	}
}
