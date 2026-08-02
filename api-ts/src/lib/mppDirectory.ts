/**
 * Outbound shaping for the third-party MPP (directory.mpp.dev) service
 * directory passthrough in routes/mcp.ts (`browse_mpp_directory` tool). See
 * docs/plans/aegis-fork-extend.md item 3.4.
 *
 * The upstream directory is third-party-controlled content ingested and
 * reflected verbatim to our agent callers — this module validates/shapes it
 * before it leaves our API, so a directory outage, malformed payload, or
 * malicious upstream response can't reach an agent unfiltered.
 *
 * The expected entry shape mirrors the existing Python MPP client's parsed
 * fields (bot/services/tempo_mpp.py `MPPService` / `get_directory`), which is
 * the only other consumer of this same upstream API in this repo:
 * url, name, description, category, feeToken, minDeposit, supportsStreaming,
 * supportsOneTime.
 */

import { z } from 'zod'
import { logger } from './logger'
import { sanitizeReflectedText } from './outboundSanitize'

/** Hard ceiling on the number of services returned, regardless of the caller's requested `limit`. */
export const MAX_MPP_SERVICES = 100

const MAX_STRING_LENGTH = 500
const MAX_DESCRIPTION_LENGTH = 1000
const MAX_CATEGORY_LENGTH = 200
const MAX_FEE_TOKEN_LENGTH = 50

/**
 * One validated, size-bounded MPP directory entry. Unknown fields are dropped
 * (zod strips by default), and every reflected string field is run through
 * sanitizeReflectedText — length alone is not enough: a description could
 * otherwise carry ANSI/control/multiline content straight to an agent caller.
 */
const MppServiceEntrySchema = z.object({
	url: z
		.string()
		.trim()
		.min(1)
		.max(MAX_STRING_LENGTH)
		.transform((s) => sanitizeReflectedText(s, MAX_STRING_LENGTH)),
	name: z
		.string()
		.trim()
		.min(1)
		.max(MAX_STRING_LENGTH)
		.transform((s) => sanitizeReflectedText(s, MAX_STRING_LENGTH)),
	description: z
		.string()
		.max(MAX_DESCRIPTION_LENGTH)
		.optional()
		.default('')
		.transform((s) => sanitizeReflectedText(s, MAX_DESCRIPTION_LENGTH)),
	category: z
		.string()
		.max(MAX_CATEGORY_LENGTH)
		.optional()
		.default('')
		.transform((s) => sanitizeReflectedText(s, MAX_CATEGORY_LENGTH)),
	feeToken: z
		.string()
		.max(MAX_FEE_TOKEN_LENGTH)
		.optional()
		.default('pathUSD')
		.transform((s) => sanitizeReflectedText(s, MAX_FEE_TOKEN_LENGTH)),
	minDeposit: z.number().finite().nonnegative().optional().default(0),
	supportsStreaming: z.boolean().optional().default(false),
	supportsOneTime: z.boolean().optional().default(true),
})

export type MppServiceEntry = z.infer<typeof MppServiceEntrySchema>

export interface MppDirectoryResult {
	services: MppServiceEntry[]
}

const EMPTY_RESULT: MppDirectoryResult = { services: [] }

/**
 * Parse+shape an upstream directory.mpp.dev response into a safe, bounded
 * projection. Fail-safe: never throws — a non-object body, a missing/
 * malformed `services` array, or per-entry schema violations degrade to an
 * empty (or partially-filtered) result rather than propagating raw upstream
 * content or crashing the tool call. Logs at warn on any drop/failure.
 */
export function parseMppDirectoryResponse(data: unknown): MppDirectoryResult {
	if (typeof data !== 'object' || data === null) {
		logger.warn('[mppDirectory] upstream response was not a JSON object; returning empty result')
		return EMPTY_RESULT
	}

	const rawServices = (data as Record<string, unknown>).services
	if (!Array.isArray(rawServices)) {
		logger.warn('[mppDirectory] upstream response missing a `services` array; returning empty result')
		return EMPTY_RESULT
	}

	const services: MppServiceEntry[] = []
	let droppedCount = 0

	for (const raw of rawServices) {
		if (services.length >= MAX_MPP_SERVICES) break
		const parsed = MppServiceEntrySchema.safeParse(raw)
		if (parsed.success) {
			services.push(parsed.data)
		} else {
			droppedCount++
		}
	}

	if (droppedCount > 0) {
		logger.warn(`[mppDirectory] dropped ${droppedCount} malformed/oversized service entr${droppedCount === 1 ? 'y' : 'ies'}`)
	}

	return { services }
}
