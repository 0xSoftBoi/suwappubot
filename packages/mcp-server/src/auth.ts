/**
 * Auth handling for the Suwappu API.
 *
 * The key is optional on purpose: the hosted endpoint leaves `tools/list` open
 * (registry validators enumerate it without credentials), so an unconfigured
 * user should still be able to see what this server offers. `tools/call`
 * checks for the key and returns an actionable message when it is missing,
 * which is friendlier than refusing to start.
 */

export interface AuthConfig {
	/** Empty string when unset — callers must check before calling tools. */
	apiKey: string
	apiUrl: string
}

export function getAuthConfig(): AuthConfig {
	return {
		apiKey: process.env.SUWAPPU_API_KEY ?? '',
		apiUrl: process.env.SUWAPPU_API_URL || 'https://api.suwappu.bot',
	}
}
