import lifecycleRegistry from '../../api-lifecycle.json'
import type { Context } from 'hono'

export type ApiLifecycleStatus = 'experimental' | 'beta' | 'ga' | 'deprecated' | 'sunset'

export type ApiLifecycleRecord = {
	surface: string
	method: string
	path: string
	status: ApiLifecycleStatus
	deprecationAt?: string
	sunsetAt?: string
	documentationUrl?: string
	replacement?: string
	fixtureOnly?: boolean
}

type LifecycleRegistry = {
	policy: string
	standards: { deprecation: string; sunset: string }
	resources: Record<string, ApiLifecycleRecord>
}

export const API_LIFECYCLE_REGISTRY = lifecycleRegistry as LifecycleRegistry

export function deprecationHeaderValue(iso: string): string {
	const millis = Date.parse(iso)
	if (!Number.isFinite(millis)) throw new Error(`Invalid deprecation date: ${iso}`)
	return `@${Math.floor(millis / 1000)}`
}

export function sunsetHeaderValue(iso: string): string {
	const date = new Date(iso)
	if (!Number.isFinite(date.getTime())) throw new Error(`Invalid sunset date: ${iso}`)
	return date.toUTCString()
}

export function validateLifecycleRecord(name: string, record: ApiLifecycleRecord): void {
	if (!record.method || !record.path || !record.status) {
		throw new Error(`Lifecycle resource ${name} is missing method/path/status`)
	}
	if ((record.status === 'deprecated' || record.status === 'sunset') && !record.deprecationAt) {
		throw new Error(`Lifecycle resource ${name} is ${record.status} but has no deprecationAt`)
	}
	if (record.sunsetAt) {
		if (!record.deprecationAt) throw new Error(`Lifecycle resource ${name} has sunsetAt without deprecationAt`)
		const deprecated = Date.parse(record.deprecationAt)
		const sunset = Date.parse(record.sunsetAt)
		if (!Number.isFinite(deprecated) || !Number.isFinite(sunset)) {
			throw new Error(`Lifecycle resource ${name} has an invalid deprecation/sunset date`)
		}
		if (sunset < deprecated) {
			throw new Error(`Lifecycle resource ${name} sunsets before it is deprecated`)
		}
	}
	if ((record.status === 'deprecated' || record.status === 'sunset') && !record.documentationUrl) {
		throw new Error(`Lifecycle resource ${name} is ${record.status} but has no documentationUrl`)
	}
}

export function validateLifecycleRegistry(registry = API_LIFECYCLE_REGISTRY): void {
	for (const [name, record] of Object.entries(registry.resources)) validateLifecycleRecord(name, record)
}

/**
 * Apply standards-based lifecycle signals to a response.
 *
 * RFC 9745 Deprecation is an RFC 9651 Structured Field Date, serialized as
 * `@<unix-seconds>`. RFC 8594 Sunset is an HTTP-date. A deprecation Link points
 * at durable migration/lifecycle documentation.
 */
export function applyLifecycleHeaders(c: Context, record: ApiLifecycleRecord): void {
	validateLifecycleRecord(`${record.method} ${record.path}`, record)

	c.header('X-Suwappu-Lifecycle', record.status)
	if (record.deprecationAt) c.header('Deprecation', deprecationHeaderValue(record.deprecationAt))
	if (record.sunsetAt) c.header('Sunset', sunsetHeaderValue(record.sunsetAt))
	if (record.documentationUrl) {
		c.header('Link', `<${record.documentationUrl}>; rel="deprecation"`)
	}
	if (record.replacement) c.header('X-Suwappu-Replacement', record.replacement)
}

export function lifecycleRecord(name: string): ApiLifecycleRecord {
	const record = API_LIFECYCLE_REGISTRY.resources[name]
	if (!record) throw new Error(`Unknown lifecycle resource: ${name}`)
	return record
}

validateLifecycleRegistry()
