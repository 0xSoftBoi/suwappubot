/**
 * HACKATHON (Tokyo 2026) — trust-layer gate tests.
 *
 * Covers the merge discipline (only ever escalates, never downgrades) and the
 * fail-open behavior when providers are unconfigured. Env config goes
 * through the real EnvService schema (Schema.decodeUnknownSync), so the
 * tests exercise the same defaults the production boot path uses.
 * Network-touching paths are stubbed with mock.module; the unconfigured
 * paths make no network calls at all.
 */
import { describe, expect, mock, test } from 'bun:test'
import { Schema } from '@effect/schema'
import { EnvSchema, type Env } from '../config/EnvService'
import { applyTrustLayerGates, screenX402Payer } from '../hackathon/gates'
import {
	ensv2Enabled,
	interceptaEnabled,
	trustLayerEnabled,
	uniswapComparisonEnabled,
} from '../hackathon/env'
import type { PolicyDecisionResult, PolicyIntent } from '../services/PolicyService'

/** Decode a minimal env patch through the real schema — same defaults as boot. */
const envOf = (patch: Record<string, string | undefined> = {}): Env => {
	const raw: Record<string, string> = {}
	for (const [k, v] of Object.entries(patch)) if (v !== undefined) raw[k] = v
	return Schema.decodeUnknownSync(EnvSchema)(raw)
}

const baseIntent = (over: Partial<PolicyIntent> = {}): PolicyIntent => ({
	organizationId: 'org_1',
	agentId: 'agent_1',
	chain: '1',
	fromToken: null,
	toToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
	valueUsd: 100,
	...over,
})

const allowResult: PolicyDecisionResult = { decision: 'allow' }

describe('trust layer flags', () => {
	test('everything is off by default', () => {
		const env = envOf()
		expect(trustLayerEnabled(env)).toBe(false)
		expect(interceptaEnabled(env)).toBe(false)
		expect(uniswapComparisonEnabled(env)).toBe(false)
	})

	test('master flag enables per-sponsor gates; uniswap stays opt-in', () => {
		const env = envOf({ HACKATHON_TRUST_LAYER: 'true' })
		expect(trustLayerEnabled(env)).toBe(true)
		expect(interceptaEnabled(env)).toBe(true)
		expect(ensv2Enabled(env)).toBe(true)
		// Explicit opt-in, independent of the master flag.
		expect(uniswapComparisonEnabled(env)).toBe(false)
		expect(uniswapComparisonEnabled(envOf({ UNISWAP_COMPARISON_ENABLED: 'true' }))).toBe(true)
	})

	test('per-sponsor flags can be disabled independently', () => {
		const env = envOf({ HACKATHON_TRUST_LAYER: 'true', HACKATHON_INTERCEPTA: 'false' })
		expect(trustLayerEnabled(env)).toBe(true)
		expect(interceptaEnabled(env)).toBe(false)
	})
})

describe('applyTrustLayerGates', () => {
	test('disabled: returns the base verdict untouched (single boolean check)', async () => {
		const out = await applyTrustLayerGates(
			{ policyIntent: baseIntent(), agentIdentifier: 'agent_1', orgId: 'org_1' },
			allowResult,
			envOf(),
		)
		expect(out).toBe(allowResult)
	})

	test('enabled but unconfigured: fails open, no escalation, no network', async () => {
		const out = await applyTrustLayerGates(
			{ policyIntent: baseIntent(), agentIdentifier: 'agent_1', orgId: 'org_1' },
			allowResult,
			envOf({ HACKATHON_TRUST_LAYER: 'true' }),
		)
		expect(out.decision).toBe('allow')
	})

	test('policy block is never downgraded by a clean trust layer', async () => {
		const blocked: PolicyDecisionResult = { decision: 'block', reason: 'policy: kill switch' }
		const out = await applyTrustLayerGates(
			{ policyIntent: baseIntent(), agentIdentifier: 'agent_1', orgId: 'org_1' },
			blocked,
			envOf({ HACKATHON_TRUST_LAYER: 'true' }),
		)
		expect(out).toBe(blocked)
	})

	test('malicious counterparty escalates allow → block', async () => {
		mock.module('../hackathon/tokyo2026/intercepta/client', () => ({
			isInterceptaConfigured: () => true,
			loadInterceptaConfig: () => ({ apiKey: 'test-key', baseUrl: 'https://x', timeoutMs: 1 }),
			scanAddress: async () => ({
				target: '0xevil',
				verdict: 'malicious',
				riskScore: 95,
				findings: [{ code: 'sanctioned', risk: 'CRITICAL', description: 'sanctioned address' }],
				raw: {},
			}),
			scanToken: async () => ({
				target: '0xtoken',
				verdict: 'safe',
				riskScore: 0,
				findings: [],
				raw: {},
			}),
		}))
		const out = await applyTrustLayerGates(
			{
				policyIntent: baseIntent({ destinationAddress: '0xevil' }),
				agentIdentifier: 'agent_1',
				orgId: 'org_1',
			},
			allowResult,
			envOf({ HACKATHON_TRUST_LAYER: 'true' }),
		)
		expect(out.decision).toBe('block')
		expect(out.reason).toContain('Intercepta')
		mock.restore()
	})

	test('suspicious counterparty escalates allow → require_approval', async () => {
		mock.module('../hackathon/tokyo2026/intercepta/client', () => ({
			isInterceptaConfigured: () => true,
			loadInterceptaConfig: () => ({ apiKey: 'test-key', baseUrl: 'https://x', timeoutMs: 1 }),
			scanAddress: async () => ({
				target: '0xshady',
				verdict: 'suspicious',
				riskScore: 55,
				findings: [{ code: 'mixer', risk: 'HIGH', description: 'mixer-adjacent' }],
				raw: {},
			}),
			scanToken: async () => ({
				target: '0xtoken',
				verdict: 'safe',
				riskScore: 0,
				findings: [],
				raw: {},
			}),
		}))
		const out = await applyTrustLayerGates(
			{
				policyIntent: baseIntent({ destinationAddress: '0xshady' }),
				agentIdentifier: 'agent_1',
				orgId: 'org_1',
			},
			allowResult,
			envOf({ HACKATHON_TRUST_LAYER: 'true' }),
		)
		expect(out.decision).toBe('require_approval')
		mock.restore()
	})
})

describe('screenX402Payer', () => {
	test('returns null when disabled or sender missing', async () => {
		expect(await screenX402Payer(undefined, envOf())).toBeNull()
		expect(await screenX402Payer('0xabc', envOf())).toBeNull()
	})

	test('returns null when enabled but unconfigured (fail-open)', async () => {
		// mock.module persists for the file after mock.restore() — re-register
		// the unconfigured shape explicitly.
		mock.module('../hackathon/tokyo2026/intercepta/client', () => ({
			isInterceptaConfigured: () => false,
			loadInterceptaConfig: () => {
				throw new Error('not configured')
			},
			scanAddress: async () => {
				throw new Error('not configured')
			},
			scanToken: async () => {
				throw new Error('not configured')
			},
		}))
		expect(await screenX402Payer('0xabc', envOf({ HACKATHON_TRUST_LAYER: 'true' }))).toBeNull()
		mock.restore()
	})
})
