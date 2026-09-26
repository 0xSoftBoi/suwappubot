import { describe, expect, it } from 'bun:test'
import { isDemoUnmeteredCall } from '../middleware/x402Payment'

/**
 * Narrow-scope MONEY-PATH coverage for the demo-agent quote-only metering
 * exemption (DEMO_UNMETERED_AGENT_IDS). This is a deliberate carve-out for the
 * showcase homepage's server-side live-quote-widget proxy key, NOT a tier
 * bypass: it must match on the quote resource exactly and fall through to
 * normal metering for every other resource, agent, or config state.
 *
 * isDemoUnmeteredCall() is the pure decision function chargeAgentForCall()
 * consults right after the BYPASS_TIERS check — testing it directly avoids
 * needing the live EnvService/DB-backed ManagedRuntime singleton that
 * chargeAgentForCall() itself depends on (see costForTool/costForEndpoint for
 * the same pure-and-exported precedent in this file).
 */
describe('isDemoUnmeteredCall — quote-only demo exemption', () => {
	const DEMO_UUID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
	const OTHER_UUID = '11111111-2222-3333-4444-555555555555'
	const demoUnmeteredAgentIds = ` ${DEMO_UUID.toLowerCase()} , some-other-id `

	it('demo agent + REST quote resource → exempt (skip demo)', () => {
		expect(
			isDemoUnmeteredCall({
				agentUuid: DEMO_UUID,
				resource: '/v1/agent/quote',
				demoUnmeteredAgentIds,
			}),
		).toBe(true)
	})

	it('demo agent + MCP quote tool resource → exempt (skip demo)', () => {
		expect(
			isDemoUnmeteredCall({
				agentUuid: DEMO_UUID,
				resource: 'mcp://tools/get_quote',
				demoUnmeteredAgentIds,
			}),
		).toBe(true)
	})

	it('demo agent + non-quote resource (e.g. swap execute) → metered, not exempt', () => {
		expect(
			isDemoUnmeteredCall({
				agentUuid: DEMO_UUID,
				resource: '/v1/agent/swap/execute',
				demoUnmeteredAgentIds,
			}),
		).toBe(false)
		expect(
			isDemoUnmeteredCall({
				agentUuid: DEMO_UUID,
				resource: 'mcp://tools/execute_swap',
				demoUnmeteredAgentIds,
			}),
		).toBe(false)
	})

	it('non-demo agent + quote resource → metered, not exempt', () => {
		expect(
			isDemoUnmeteredCall({
				agentUuid: OTHER_UUID,
				resource: '/v1/agent/quote',
				demoUnmeteredAgentIds,
			}),
		).toBe(false)
	})

	it('env unset (DEMO_UNMETERED_AGENT_IDS undefined) → metered for everyone', () => {
		expect(
			isDemoUnmeteredCall({
				agentUuid: DEMO_UUID,
				resource: '/v1/agent/quote',
				demoUnmeteredAgentIds: undefined,
			}),
		).toBe(false)
	})

	it('no agent uuid in scope → never exempt, regardless of resource/config', () => {
		expect(
			isDemoUnmeteredCall({
				agentUuid: undefined,
				resource: '/v1/agent/quote',
				demoUnmeteredAgentIds,
			}),
		).toBe(false)
	})
})
