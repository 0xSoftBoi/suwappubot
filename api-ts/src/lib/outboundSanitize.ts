/**
 * Outbound sanitization helpers — for content that flows back OUT to agents
 * after it has passed through an untrusted seam (third-party API passthrough,
 * or a verbatim echo of caller-supplied free text). See
 * docs/plans/aegis-fork-extend.md item 3.4.
 *
 * Distinct from ../aegis/ (which scans INBOUND agent input for prompt-
 * injection signatures). This module does no threat scoring — it only bounds
 * length and strips control/formatting sequences before text is reflected
 * back to a caller, so the echo channel can't be used to smuggle
 * multi-line/ANSI/control-sequence content into another agent's rendered
 * response.
 */

/** Default cap for reflected free-text (e.g. an A2A "unrecognized command" echo). */
export const DEFAULT_REFLECTED_TEXT_MAX_LENGTH = 300

// C0 controls (0x00-0x1F, includes \n \r \t), DEL (0x7F), and C1 controls
// (0x80-0x9F). Built via String.fromCharCode ranges (rather than a literal
// regex control-char class) so the source file itself stays free of raw
// control bytes.
function buildControlCharPattern(): RegExp {
	const ranges: Array<[number, number]> = [
		[0x00, 0x1f],
		[0x7f, 0x9f],
	]
	const chars: string[] = []
	for (const [start, end] of ranges) {
		for (let code = start; code <= end; code++) {
			chars.push(String.fromCharCode(code))
		}
	}
	const escaped = chars.map((c) => `\\u{${c.codePointAt(0)!.toString(16).padStart(4, '0')}}`).join('')
	return new RegExp(`[${escaped}]`, 'gu')
}

const CONTROL_CHAR_PATTERN = buildControlCharPattern()

/**
 * Scrub free-text before reflecting it back to an agent/client. Collapses
 * newlines and other C0/C1 control characters (and DEL) to spaces, trims
 * repeated whitespace, and hard-caps the result length.
 *
 * Fail-safe: never throws. Non-string input becomes an empty string.
 */
export function sanitizeReflectedText(
	input: unknown,
	maxLength: number = DEFAULT_REFLECTED_TEXT_MAX_LENGTH,
): string {
	if (typeof input !== 'string') return ''

	const withoutControlChars = input.replace(CONTROL_CHAR_PATTERN, ' ')
	const collapsed = withoutControlChars.replace(/\s+/g, ' ').trim()

	if (collapsed.length <= maxLength) return collapsed
	return `${collapsed.slice(0, maxLength).trim()}…`
}
