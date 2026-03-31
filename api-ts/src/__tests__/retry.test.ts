import { describe, expect, it, mock } from 'bun:test'
import { fetchWithRetry } from '../lib/retry'

describe('fetchWithRetry', () => {
	it('returns response on first success', async () => {
		const mockResponse = new Response('ok', { status: 200 })
		const originalFetch = globalThis.fetch
		globalThis.fetch = Object.assign(mock(() => Promise.resolve(mockResponse)), {
			preconnect: originalFetch.preconnect,
		}) as typeof fetch

		const res = await fetchWithRetry('https://example.com', {})
		expect(res.status).toBe(200)
		expect(globalThis.fetch).toHaveBeenCalledTimes(1)

		globalThis.fetch = originalFetch
	})

	it('retries on network error and succeeds', async () => {
		const mockResponse = new Response('ok', { status: 200 })
		let attempt = 0
		const originalFetch = globalThis.fetch
		globalThis.fetch = Object.assign(
			mock(() => {
				attempt++
				if (attempt < 3) throw new Error('network error')
				return Promise.resolve(mockResponse)
			}),
			{ preconnect: originalFetch.preconnect },
		) as typeof fetch

		const res = await fetchWithRetry('https://example.com', {}, { baseDelayMs: 10 })
		expect(res.status).toBe(200)
		expect(globalThis.fetch).toHaveBeenCalledTimes(3)

		globalThis.fetch = originalFetch
	})

	it('throws after exhausting retries', async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = Object.assign(
			mock(() => {
				throw new Error('persistent failure')
			}),
			{ preconnect: originalFetch.preconnect },
		) as typeof fetch

		await expect(
			fetchWithRetry('https://example.com', {}, { maxRetries: 2, baseDelayMs: 10 }),
		).rejects.toThrow('persistent failure')
		expect(globalThis.fetch).toHaveBeenCalledTimes(3) // initial + 2 retries

		globalThis.fetch = originalFetch
	})

	it('does not retry on successful HTTP error responses', async () => {
		const mockResponse = new Response('not found', { status: 404 })
		const originalFetch = globalThis.fetch
		globalThis.fetch = Object.assign(mock(() => Promise.resolve(mockResponse)), {
			preconnect: originalFetch.preconnect,
		}) as typeof fetch

		const res = await fetchWithRetry('https://example.com', {}, { baseDelayMs: 10 })
		expect(res.status).toBe(404)
		expect(globalThis.fetch).toHaveBeenCalledTimes(1) // no retry for HTTP errors

		globalThis.fetch = originalFetch
	})
})
