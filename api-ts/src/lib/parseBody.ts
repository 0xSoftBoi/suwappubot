import type { Context } from 'hono'

/**
 * Safely parse JSON body from a request.
 * Returns null if body is missing or invalid JSON.
 */
export async function parseJsonBody<T = unknown>(c: Context): Promise<T | null> {
	try {
		return (await c.req.json()) as T
	} catch {
		return null
	}
}
