/**
 * Auth handling for Suwappu API.
 *
 * Uses API key passed via SUWAPPU_API_KEY env var.
 * The key is sent as a Bearer token in the Authorization header.
 */

export interface AuthConfig {
	apiKey: string
	apiUrl: string
}

export function getAuthConfig(): AuthConfig {
	const apiKey = process.env.SUWAPPU_API_KEY
	if (!apiKey) {
		throw new Error(
			'SUWAPPU_API_KEY environment variable is required.\n' +
				'Get one at: curl -X POST https://api.suwappu.bot/v1/agent/register -H "Content-Type: application/json" -d \'{"name": "my-agent"}\''
		)
	}

	const apiUrl = process.env.SUWAPPU_API_URL || 'https://api.suwappu.bot'

	return { apiKey, apiUrl }
}

export function getAuthHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json',
		'User-Agent': 'suwappu-mcp-server/0.5.0',
	}
}
