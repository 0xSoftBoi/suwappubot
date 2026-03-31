/**
 * Retry a fetch call with exponential backoff.
 * Used for critical external calls like RPC broadcasts.
 */
export async function fetchWithRetry(
	url: string,
	init: RequestInit,
	opts: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
	const { maxRetries = 3, baseDelayMs = 500 } = opts
	let lastError: Error | undefined

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const res = await fetch(url, init)
			return res
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err))
			if (attempt < maxRetries) {
				const delay = baseDelayMs * 2 ** attempt
				await new Promise((r) => setTimeout(r, delay))
			}
		}
	}

	throw lastError ?? new Error('fetchWithRetry: all attempts failed')
}
