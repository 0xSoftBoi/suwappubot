import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { PolymarketArchiveService, PolymarketArchiveServiceLive } from '../services/PolymarketArchiveService'

// Pure URL-construction/era-resolution logic in PolymarketArchiveService.getHours —
// no network calls, so these run against the real Layer directly.

function runHours(params: { start: string; end: string; era?: 'pmxt/v1' | 'pmxt/v2' | 'third-party/ag6' | 'v3' }) {
	const program = Effect.gen(function* () {
		const archive = yield* PolymarketArchiveService
		return yield* archive.getHours(params)
	}).pipe(Effect.provide(PolymarketArchiveServiceLive))
	return Effect.runPromise(program)
}

function runHoursEither(params: { start: string; end: string; era?: 'pmxt/v1' | 'pmxt/v2' | 'third-party/ag6' | 'v3' }) {
	const program = Effect.gen(function* () {
		const archive = yield* PolymarketArchiveService
		return yield* archive.getHours(params)
	}).pipe(Effect.provide(PolymarketArchiveServiceLive), Effect.either)
	return Effect.runPromise(program)
}

describe('PolymarketArchiveService.getHours', () => {
	test('resolves a v3 hour to the v3/YYYY-MM-DD/HH path + manifest sidecar', async () => {
		const hours = await runHours({ start: '2026-08-18T06:00:00Z', end: '2026-08-18T06:00:00Z' })
		expect(hours).toHaveLength(1)
		expect(hours[0]).toMatchObject({
			hourUtc: '2026-08-18T06:00:00Z',
			era: 'v3',
			url: 'https://archive.pendulumflow.com/v3/2026-08-18/06/2026-08-18T06.parquet',
			manifestUrl: 'https://archive.pendulumflow.com/v3/2026-08-18/06/manifest.json',
			outsideKnownSpan: false,
		})
	})

	test('resolves an ag6-only hour (the pmxt->v3 bridge) to the third-party path', async () => {
		const hours = await runHours({ start: '2026-08-12T00:00:00Z', end: '2026-08-12T00:00:00Z' })
		expect(hours[0]).toMatchObject({
			era: 'third-party/ag6',
			url: 'https://archive.pendulumflow.com/third-party/ag6/polymarket_orderbook_2026-08-12T00.parquet',
			manifestUrl: null,
			outsideKnownSpan: false,
		})
	})

	test('prefers pmxt/v2 over ag6 on their 4-hour overlap', async () => {
		const hours = await runHours({ start: '2026-08-09T21:00:00Z', end: '2026-08-09T21:00:00Z' })
		expect(hours[0].era).toBe('pmxt/v2')
	})

	test('the 68h ag6->v3 hole stays outsideKnownSpan', async () => {
		const hours = await runHours({ start: '2026-08-15T09:00:00Z', end: '2026-08-15T11:00:00Z' })
		expect(hours.map((h) => h.era)).toEqual(['third-party/ag6', null, null])
		expect(hours[1].outsideKnownSpan).toBe(true)
	})

	test('resolves a pmxt/v1-only hour to the pmxt/v1 basename path, no manifest', async () => {
		const hours = await runHours({ start: '2026-03-01T00:00:00Z', end: '2026-03-01T00:00:00Z' })
		expect(hours[0]).toMatchObject({
			era: 'pmxt/v1',
			url: 'https://archive.pendulumflow.com/pmxt/v1/polymarket_orderbook_2026-03-01T00.parquet',
			manifestUrl: null,
			outsideKnownSpan: false,
		})
	})

	test('on v1/v2 overlap, prefers v2 over v1 when no era is pinned', async () => {
		// 2026-04-14 falls inside both pmxt/v1 (ends 04-16T05) and pmxt/v2 (starts 04-13T19).
		const hours = await runHours({ start: '2026-04-14T12:00:00Z', end: '2026-04-14T12:00:00Z' })
		expect(hours[0].era).toBe('pmxt/v2')
		expect(hours[0].outsideKnownSpan).toBe(false)
	})

	test('pinning era=pmxt/v1 on an overlap hour still returns v1, not the preferred v2', async () => {
		const hours = await runHours({
			start: '2026-04-14T12:00:00Z',
			end: '2026-04-14T12:00:00Z',
			era: 'pmxt/v1',
		})
		expect(hours[0].era).toBe('pmxt/v1')
		expect(hours[0].url).toContain('pmxt/v1/polymarket_orderbook_2026-04-14T12.parquet')
	})

	test('an hour before every era span is flagged outsideKnownSpan and not dropped', async () => {
		const hours = await runHours({ start: '2020-01-01T00:00:00Z', end: '2020-01-01T00:00:00Z' })
		expect(hours).toHaveLength(1)
		expect(hours[0]).toMatchObject({ era: null, url: null, manifestUrl: null, outsideKnownSpan: true })
	})

	test('v3 is ongoing — an hour far in the future still resolves to v3, flagged outsideKnownSpan=false', async () => {
		const hours = await runHours({ start: '2030-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z' })
		expect(hours[0]).toMatchObject({ era: 'v3', outsideKnownSpan: false })
	})

	test('pinning an era outside its own span still builds a URL but flags outsideKnownSpan', async () => {
		const hours = await runHours({
			start: '2020-01-01T00:00:00Z',
			end: '2020-01-01T00:00:00Z',
			era: 'v3',
		})
		expect(hours[0]).toMatchObject({ era: 'v3', outsideKnownSpan: true })
		expect(hours[0].url).not.toBeNull()
	})

	test('multi-hour range returns one entry per hour, inclusive of both ends', async () => {
		const hours = await runHours({ start: '2026-08-18T06:00:00Z', end: '2026-08-18T09:00:00Z' })
		expect(hours).toHaveLength(4)
		expect(hours.map((h) => h.hourUtc)).toEqual([
			'2026-08-18T06:00:00Z',
			'2026-08-18T07:00:00Z',
			'2026-08-18T08:00:00Z',
			'2026-08-18T09:00:00Z',
		])
	})

	test('non-hour-aligned start/end are floored to the top of the hour', async () => {
		const hours = await runHours({ start: '2026-08-18T06:45:00Z', end: '2026-08-18T06:59:59Z' })
		expect(hours).toHaveLength(1)
		expect(hours[0].hourUtc).toBe('2026-08-18T06:00:00Z')
	})

	test('rejects a range over the 168-hour cap', async () => {
		const result = await runHoursEither({ start: '2026-08-18T00:00:00Z', end: '2026-08-26T01:00:00Z' })
		expect(result._tag).toBe('Left')
	})

	test('rejects end before start', async () => {
		const result = await runHoursEither({ start: '2026-08-18T06:00:00Z', end: '2026-08-18T00:00:00Z' })
		expect(result._tag).toBe('Left')
	})

	test('rejects an invalid ISO timestamp', async () => {
		const result = await runHoursEither({ start: 'not-a-date', end: '2026-08-18T06:00:00Z' })
		expect(result._tag).toBe('Left')
	})
})
