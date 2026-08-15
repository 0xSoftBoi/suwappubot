/**
 * Auth handling for the Suwappu API.
 *
 * The key is optional on purpose: the hosted MCP endpoint leaves lifecycle
 * discovery and a small public read-tool surface available without credentials.
 * This stdio bridge does not duplicate that allowlist; it simply omits the
 * Authorization header when no key is configured and lets the hosted server
 * enforce the current policy for each request.
 */

export interface AuthConfig {
	/** Empty string when unset — the bridge then omits the Authorization header. */
	apiKey: string
	apiUrl: string
}

export function getAuthConfig(): AuthConfig {
	return {
		apiKey: process.env.SUWAPPU_API_KEY ?? '',
		apiUrl: process.env.SUWAPPU_API_URL || 'https://api.suwappu.bot',
	}
}
