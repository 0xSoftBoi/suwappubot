import { describe, expect, test } from 'bun:test'
import { Schema } from '@effect/schema'
import { EnvSchema, type Env } from '../config/EnvService'
import { hackathonEnv, initHackathonEnv, trustLayerEnabled } from '../hackathon/env'

/** Decode a minimal env patch through the real schema — same defaults as boot. */
const envOf = (patch: Record<string, string | undefined> = {}): Env => {
	const raw: Record<string, string> = {}
	for (const [k, v] of Object.entries(patch)) if (v !== undefined) raw[k] = v
	return Schema.decodeUnknownSync(EnvSchema)(raw)
}

describe('hackathon env seeding', () => {
	test('initHackathonEnv seeds the snapshot used by zero-arg flag reads', () => {
		// The seeded value wins over whatever the process environment holds:
		// this is how src/index.ts injects the decoded EnvService value at boot.
		initHackathonEnv(envOf({ HACKATHON_TRUST_LAYER: 'true' }))
		expect(hackathonEnv().HACKATHON_TRUST_LAYER).toBe('true')
		expect(trustLayerEnabled()).toBe(true)
	})

	test('reseed replaces the snapshot', () => {
		initHackathonEnv(envOf({ HACKATHON_TRUST_LAYER: 'true' }))
		initHackathonEnv(envOf())
		expect(hackathonEnv().HACKATHON_TRUST_LAYER).toBe('false')
		expect(trustLayerEnabled()).toBe(false)
	})
})
