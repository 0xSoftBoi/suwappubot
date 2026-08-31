import { Context, Effect, Layer } from 'effect'
import { TTLCache } from '../lib/cache'

// ---------------------------------------------------------------------------
// Polymarket historical-data archive integration.
//
// https://archive.pendulumflow.com is a free, donation-funded, no-auth
// archive of hourly Polymarket CLOB orderbook/trade Parquet snapshots,
// published under CC BY 4.0 by pendulumflow (v3/) and pmxt (pmxt/v1,
// pmxt/v2 — see https://archive.pmxt.dev). This service is READ-ONLY
// metadata/URL-construction — it never downloads or parses the Parquet
// files themselves, only the small JSON sidecars (COVERAGE/SCHEMA/
// INCIDENTS/manifest) and the deterministic hourly file paths.
//
// Four eras exist and are NOT interchangeable or safely concatenable:
//   - pmxt/v1: 2026-02-21T18 -> 2026-04-16T05 UTC. price_change + book_snapshot
//     only (no trades). Millisecond timestamps.
//   - pmxt/v2: 2026-04-13T19 -> 2026-08-09T23 UTC. Adds last_trade_price and
//     tick_size_change (trades). Millisecond timestamps.
//   - third-party/ag6: 2026-08-09T20 -> 2026-08-15T09 UTC. ag6's single-source
//     capture (same 16-column schema as pmxt/v2), mirrored 2026-08-26, quality
//     audit pending, NO licence stated. Bridges most of the pmxt->v3 handover;
//     the only true hole is 68h, 2026-08-15T10 -> 2026-08-18T05.
//   - v3: 2026-08-18T06 UTC -> ongoing (open-ended). Native capture with a
//     richer event set (best_bid_ask, book, last_trade_price,
//     market_resolved, new_market, price_change, tick_size_change),
//     MICROSECOND `timestamp_received`, and a `sequence` column. Ships a
//     manifest.json sidecar per hour directory.
//
// v1 and v2 OVERLAP 2026-04-13 -> 2026-04-16 (59 basenames exist in both eras
// with different bytes) — callers must never key a file purely by basename
// across eras; the era-qualified URL is the only safe identity.
// ---------------------------------------------------------------------------

export const ARCHIVE_BASE_URL = 'https://archive.pendulumflow.com'

export type ArchiveEra = 'pmxt/v1' | 'pmxt/v2' | 'third-party/ag6' | 'v3'

export interface ArchiveEraInfo {
	era: ArchiveEra
	/** Path prefix used to build hourly file URLs and the COVERAGE/SCHEMA sidecar URLs. */
	prefix: string
	/** ISO 8601 UTC hour the era's data begins. */
	spanStart: string
	/** ISO 8601 UTC hour the era's data ends, or `null` if still ongoing. */
	spanEnd: string | null
	/** Example hourly file path template (relative to the archive base URL). */
	pathTemplate: string
	/** Whether this era's hour directories also publish a manifest.json sidecar. */
	hasManifest: boolean
	eventTypes: string[]
	hasTrades: boolean
	timestampField: string
	timestampUnit: 'ms' | 'us'
	hasSequenceColumn: boolean
	/**
	 * Whether `<prefix>COVERAGE.json` / `<prefix>SCHEMA.json` are actually
	 * published for this era today. As of live probing, only v3/ serves them —
	 * pmxt/v1/COVERAGE.json and pmxt/v2/COVERAGE.json currently 404. This is a
	 * live-archive fact, not a spec guarantee, so treat it as best-effort and
	 * always handle a 404 from getCoverage() gracefully rather than assuming
	 * this flag stays accurate forever.
	 */
	metadataSidecarAvailable: boolean
	notes: string[]
}

export interface ArchiveCoverageResult {
	era: ArchiveEra
	available: boolean
	url: string
	data: unknown | null
}

export interface ArchiveInfo {
	baseUrl: string
	license: string
	attribution: {
		v3: string
		pmxt: string
		ag6: string
	}
	donationNote: string
	metadataEndpoints: {
		coverage: string
		schema: string
		incidents: string
	}
	eras: ArchiveEraInfo[]
	caveats: string[]
}

export interface ArchiveHourResult {
	hourUtc: string
	era: ArchiveEra | null
	url: string | null
	manifestUrl: string | null
	outsideKnownSpan: boolean
}

export class ArchiveValidationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ArchiveValidationError'
	}
}

export class ArchiveNotFoundError extends Error {
	readonly notFound = true as const
	constructor(message: string) {
		super(message)
		this.name = 'ArchiveNotFoundError'
	}
}

export class PolymarketArchiveService extends Context.Tag('PolymarketArchiveService')<
	PolymarketArchiveService,
	{
		getInfo: () => Effect.Effect<ArchiveInfo, never>
		// Degrades gracefully when a prefix's COVERAGE.json 404s (currently true
		// for both pmxt eras) — returns `available: false`, never fails the Effect
		// for a plain 404. Only unexpected upstream errors (5xx, network) fail.
		getCoverage: (era: ArchiveEra) => Effect.Effect<ArchiveCoverageResult, Error>
		getIncidents: () => Effect.Effect<unknown, Error>
		getHours: (params: {
			start: string
			end: string
			era?: ArchiveEra
		}) => Effect.Effect<ArchiveHourResult[], Error>
		getHourManifest: (date: string, hour: string) => Effect.Effect<unknown, Error>
	}
>() {}

// ---------- Static era registry ----------

const ERA_REGISTRY: ArchiveEraInfo[] = [
	{
		era: 'pmxt/v1',
		prefix: 'pmxt/v1/',
		spanStart: '2026-02-21T18:00:00Z',
		spanEnd: '2026-04-16T05:00:00Z',
		pathTemplate: 'pmxt/v1/polymarket_orderbook_YYYY-MM-DDTHH.parquet',
		hasManifest: false,
		eventTypes: ['price_change', 'book_snapshot'],
		hasTrades: false,
		timestampField: 'timestamp',
		timestampUnit: 'ms',
		hasSequenceColumn: false,
		metadataSidecarAvailable: false,
		notes: [
			'No trade events in this era — use pmxt/v2 or v3 for last_trade_price.',
			'pmxt/v1/COVERAGE.json and pmxt/v1/SCHEMA.json currently 404 — this era ' +
				'does not (yet) publish the metadata sidecars.',
		],
	},
	{
		era: 'pmxt/v2',
		prefix: 'pmxt/v2/',
		spanStart: '2026-04-13T19:00:00Z',
		spanEnd: '2026-08-09T23:00:00Z',
		pathTemplate: 'pmxt/v2/polymarket_orderbook_YYYY-MM-DDTHH.parquet',
		hasManifest: false,
		eventTypes: ['price_change', 'book', 'last_trade_price', 'tick_size_change'],
		hasTrades: true,
		timestampField: 'timestamp',
		timestampUnit: 'ms',
		hasSequenceColumn: false,
		metadataSidecarAvailable: false,
		notes: [
			'Overlaps pmxt/v1 from 2026-04-13 to 2026-04-16 UTC — 59 basenames exist ' +
				'in both eras with different bytes. Never key a file by basename alone ' +
				'across eras; always use the era-qualified URL.',
			'pmxt/v2/COVERAGE.json and pmxt/v2/SCHEMA.json currently 404 — this era ' +
				'does not (yet) publish the metadata sidecars.',
		],
	},
	{
		era: 'third-party/ag6',
		prefix: 'third-party/ag6/',
		spanStart: '2026-08-09T20:00:00Z',
		spanEnd: '2026-08-15T09:00:00Z',
		pathTemplate: 'third-party/ag6/polymarket_orderbook_YYYY-MM-DDTHH.parquet',
		hasManifest: false,
		eventTypes: ['price_change', 'book', 'last_trade_price', 'tick_size_change'],
		hasTrades: true,
		timestampField: 'timestamp',
		timestampUnit: 'ms',
		hasSequenceColumn: false,
		metadataSidecarAvailable: false,
		notes: [
			"Third-party capture by ag6, mirrored 2026-08-26 from polymarket-archive.ag6.ai. " +
				'Single source, no witness pipeline, no per-hour coverage verdicts; the ' +
				"archive's quality audit of it is pending. NO LICENCE STATED (credit ag6).",
			'Same 16-column schema as pmxt/v2 (measured by the archive). Includes a ' +
				"COMPLETE 2026-08-10T00 — the hour pmxt's own capture truncated — and " +
				'overlaps pmxt/v2 for its first 4 hours (2026-08-09T20..23).',
			'No SHA256SUMS.txt is published for this era.',
		],
	},
	{
		era: 'v3',
		prefix: 'v3/',
		spanStart: '2026-08-18T06:00:00Z',
		spanEnd: null,
		pathTemplate: 'v3/YYYY-MM-DD/HH/YYYY-MM-DDTHH.parquet (+ manifest.json sidecar in the same directory)',
		hasManifest: true,
		eventTypes: [
			'best_bid_ask',
			'book',
			'last_trade_price',
			'market_resolved',
			'new_market',
			'price_change',
			'tick_size_change',
		],
		hasTrades: true,
		timestampField: 'timestamp_received',
		timestampUnit: 'us',
		hasSequenceColumn: true,
		metadataSidecarAvailable: true,
		notes: [
			'Native capture (not backfilled from pmxt). Ongoing — spanEnd is null. ' +
				'timestamp_received is MICROSECONDS, unlike the millisecond pmxt/v1 and ' +
				'pmxt/v2 timestamps — do not compare across eras without converting units.',
		],
	},
]

const ERA_BY_ID: Record<ArchiveEra, ArchiveEraInfo> = {
	'pmxt/v1': ERA_REGISTRY[0],
	'pmxt/v2': ERA_REGISTRY[1],
	'third-party/ag6': ERA_REGISTRY[2],
	v3: ERA_REGISTRY[3],
}

// Preference order when resolving an hour to an era on overlap: v3 (native,
// attested), then the licensed pmxt mirrors (v2 over v1 where they overlap),
// then unaudited third-party ag6 only where nothing else serves the hour
// (2026-08-10T00 .. 2026-08-15T09).
const ERA_PREFERENCE: ArchiveEra[] = ['v3', 'pmxt/v2', 'third-party/ag6', 'pmxt/v1']

const ATTRIBUTION = {
	v3: 'Data from the Polymarket historical archive (v3/), credit: pendulumflow (https://archive.pendulumflow.com), CC BY 4.0.',
	pmxt: 'Data from the Polymarket historical archive (pmxt/), credit: pmxt (https://archive.pmxt.dev), CC BY 4.0.',
	ag6: 'Data from the Polymarket historical archive (third-party/ag6/), credit: ag6 — no licence stated.',
}

const DONATION_NOTE =
	'archive.pendulumflow.com is a free, donation-funded public archive with no ' +
	'authentication required. It has no SLA — treat outages/gaps as expected and ' +
	'check INCIDENTS.json before assuming a request-side bug.'

function buildInfo(): ArchiveInfo {
	return {
		baseUrl: ARCHIVE_BASE_URL,
		license: 'CC BY 4.0 for v3/ and pmxt/*; third-party/ag6/ states no licence',
		attribution: ATTRIBUTION,
		donationNote: DONATION_NOTE,
		metadataEndpoints: {
			coverage: `${ARCHIVE_BASE_URL}/<prefix>COVERAGE.json`,
			schema: `${ARCHIVE_BASE_URL}/<prefix>SCHEMA.json`,
			incidents: `${ARCHIVE_BASE_URL}/INCIDENTS.json`,
		},
		eras: ERA_REGISTRY,
		caveats: [
			'pmxt/v1 and pmxt/v2 overlap 2026-04-13 -> 2026-04-16 UTC with 59 shared ' +
				'basenames that contain DIFFERENT bytes in each era — never key a file ' +
				'by basename alone.',
			'Eras are not interchangeable or safely concatenable: schemas, event ' +
				'types, and timestamp units (ms for pmxt/*, microseconds for v3/) differ ' +
				'across era boundaries.',
			'v3/ is open-ended ("ongoing") — its spanEnd is null, not a fixed date.',
			'The chain is NOT continuous: after third-party/ag6 ends there is a ' +
				'68-hour hole, 2026-08-15T10 -> 2026-08-18T05 UTC, that nothing covers.',
			'v3 hours group rows by event type, and the manifest gives each type its ' +
				"own byte_range, row_count and sha256 — a query engine can read one " +
				'event type over HTTP Range requests without downloading the hour.',
			'This archive is donation-funded with no SLA; consult INCIDENTS.json for known gaps/outages.',
			'As of live probing, only v3/ actually serves COVERAGE.json/SCHEMA.json — ' +
				'pmxt/v1 and pmxt/v2 currently 404 on both. getCoverage() reflects this ' +
				'as `available: false` rather than an error; check each era\'s ' +
				'`metadataSidecarAvailable` flag before relying on it.',
		],
	}
}

// ---------- HTTP + caching ----------

const jsonCache = new TTLCache<unknown>(5 * 60 * 1000)

async function fetchJson(url: string): Promise<unknown> {
	const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
	if (res.status === 404) {
		throw new ArchiveNotFoundError(`Archive resource not found: ${url}`)
	}
	if (!res.ok) {
		throw new Error(`Archive fetch error ${res.status} for ${url}`)
	}
	return res.json()
}

async function getCachedJson(cacheKey: string, url: string): Promise<unknown> {
	const cached = jsonCache.get(cacheKey)
	if (cached !== null) return cached
	const data = await fetchJson(url)
	jsonCache.set(cacheKey, data)
	return data
}

// COVERAGE.json is NOT guaranteed to exist for every era — live probing shows
// only v3/ currently publishes it; pmxt/v1 and pmxt/v2 404. A 404 here is a
// normal, expected outcome (not every era in the registry has shipped its
// metadata sidecar yet), so it degrades to `available: false` instead of
// failing the Effect. Only non-404 upstream failures (5xx, network) propagate
// as errors. The negative result is cached too, so a persistently-missing
// sidecar doesn't get re-fetched every call within the TTL.
const coverageCache = new TTLCache<ArchiveCoverageResult>(5 * 60 * 1000)

async function getCoverageImpl(era: ArchiveEra): Promise<ArchiveCoverageResult> {
	const cached = coverageCache.get(era)
	if (cached !== null) return cached

	const info = ERA_BY_ID[era]
	const url = `${ARCHIVE_BASE_URL}/${info.prefix}COVERAGE.json`

	let result: ArchiveCoverageResult
	try {
		const data = await fetchJson(url)
		result = { era, available: true, url, data }
	} catch (e) {
		if (e instanceof ArchiveNotFoundError) {
			result = { era, available: false, url, data: null }
		} else {
			throw e
		}
	}

	coverageCache.set(era, result)
	return result
}

async function getIncidentsImpl(): Promise<unknown> {
	const url = `${ARCHIVE_BASE_URL}/INCIDENTS.json`
	return getCachedJson('incidents', url)
}

async function getHourManifestImpl(date: string, hour: string): Promise<unknown> {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw new ArchiveValidationError(`Invalid date "${date}" — expected YYYY-MM-DD`)
	}
	if (!/^\d{2}$/.test(hour)) {
		throw new ArchiveValidationError(`Invalid hour "${hour}" — expected two-digit HH (00-23)`)
	}
	const url = `${ARCHIVE_BASE_URL}/v3/${date}/${hour}/manifest.json`
	return getCachedJson(`manifest:${date}:${hour}`, url)
}

// ---------- Pure URL construction (getHours) ----------

const MAX_RANGE_HOURS = 168

function parseIsoOrThrow(value: string, label: string): Date {
	const d = new Date(value)
	if (Number.isNaN(d.getTime())) {
		throw new ArchiveValidationError(`Invalid ${label} timestamp "${value}" — expected ISO 8601`)
	}
	return d
}

function floorToHour(d: Date): Date {
	const floored = new Date(d)
	floored.setUTCMinutes(0, 0, 0)
	return floored
}

/** "2026-08-18T06" from a Date already floored to the hour. */
function hourBasename(d: Date): string {
	return d.toISOString().slice(0, 13)
}

function isWithinSpan(hourMs: number, spec: ArchiveEraInfo): boolean {
	const startMs = new Date(spec.spanStart).getTime()
	if (hourMs < startMs) return false
	if (spec.spanEnd === null) return true
	return hourMs <= new Date(spec.spanEnd).getTime()
}

function resolveEraForHour(hourMs: number): ArchiveEra | null {
	for (const era of ERA_PREFERENCE) {
		if (isWithinSpan(hourMs, ERA_BY_ID[era])) return era
	}
	return null
}

function buildHourUrl(era: ArchiveEra, hourDate: Date): { url: string; manifestUrl: string | null } {
	const basename = hourBasename(hourDate)
	if (era === 'v3') {
		const datePart = basename.slice(0, 10)
		const hourPart = basename.slice(11, 13)
		return {
			url: `${ARCHIVE_BASE_URL}/v3/${datePart}/${hourPart}/${basename}.parquet`,
			manifestUrl: `${ARCHIVE_BASE_URL}/v3/${datePart}/${hourPart}/manifest.json`,
		}
	}
	const prefix = ERA_BY_ID[era].prefix
	return {
		url: `${ARCHIVE_BASE_URL}/${prefix}polymarket_orderbook_${basename}.parquet`,
		manifestUrl: null,
	}
}

function getHoursImpl(params: { start: string; end: string; era?: ArchiveEra }): ArchiveHourResult[] {
	const startDate = floorToHour(parseIsoOrThrow(params.start, 'start'))
	const endDate = floorToHour(parseIsoOrThrow(params.end, 'end'))

	if (endDate.getTime() < startDate.getTime()) {
		throw new ArchiveValidationError('`end` must not be before `start`')
	}

	const hourMs = 60 * 60 * 1000
	const totalHours = (endDate.getTime() - startDate.getTime()) / hourMs + 1

	if (totalHours > MAX_RANGE_HOURS) {
		throw new ArchiveValidationError(
			`Requested range spans ${totalHours} hours, exceeding the ${MAX_RANGE_HOURS}-hour cap per request. Narrow start/end.`,
		)
	}

	if (params.era && !ERA_BY_ID[params.era]) {
		throw new ArchiveValidationError(`Unknown era "${params.era}"`)
	}

	const results: ArchiveHourResult[] = []
	for (let i = 0; i < totalHours; i++) {
		const hourDate = new Date(startDate.getTime() + i * hourMs)
		const hourMsValue = hourDate.getTime()

		const resolvedEra = params.era ?? resolveEraForHour(hourMsValue)

		if (!resolvedEra) {
			results.push({
				hourUtc: hourBasename(hourDate) + ':00:00Z',
				era: null,
				url: null,
				manifestUrl: null,
				outsideKnownSpan: true,
			})
			continue
		}

		const outsideKnownSpan = !isWithinSpan(hourMsValue, ERA_BY_ID[resolvedEra])
		const { url, manifestUrl } = buildHourUrl(resolvedEra, hourDate)

		results.push({
			hourUtc: hourBasename(hourDate) + ':00:00Z',
			era: resolvedEra,
			url,
			manifestUrl,
			outsideKnownSpan,
		})
	}

	return results
}

// ---------- Layer ----------

export const PolymarketArchiveServiceLive = Layer.succeed(PolymarketArchiveService, {
	getInfo: () => Effect.succeed(buildInfo()),
	getCoverage: (era) =>
		Effect.tryPromise({ try: () => getCoverageImpl(era), catch: (e) => e as Error }),
	getIncidents: () =>
		Effect.tryPromise({ try: () => getIncidentsImpl(), catch: (e) => e as Error }),
	getHours: (params) =>
		Effect.try({ try: () => getHoursImpl(params), catch: (e) => e as Error }),
	getHourManifest: (date, hour) =>
		Effect.tryPromise({ try: () => getHourManifestImpl(date, hour), catch: (e) => e as Error }),
})
