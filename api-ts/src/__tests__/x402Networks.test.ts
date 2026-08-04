import { describe, expect, it } from 'bun:test'
import {
	BASE_USDC,
	ROBINHOOD_USDG,
	X402_NETWORKS,
	resolveX402Networks,
} from '../config/x402Networks'
import { buildX402Challenge } from '../middleware/x402Payment'

const ENV = {
	FEE_WALLET_EVM: '0x000000000000000000000000000000000000dEaD',
	AGENT_METERING_NETWORK: 'base',
	AGENT_METERING_USDC_ADDRESS: BASE_USDC.asset,
}

const OPTS = { cost: 10, resource: '/v1/agent/x', description: 'test' }

describe('x402 network registry', () => {
	it('pins Robinhood Chain to USDG with its verified EIP-712 domain', () => {
		// version() reverts on the USDG contract; this domain was derived by
		// matching the on-chain DOMAIN_SEPARATOR. Changing it silently breaks
		// signature recovery, so lock it down.
		expect(ROBINHOOD_USDG.chainId).toBe(4663)
		expect(ROBINHOOD_USDG.asset).toBe('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
		expect(ROBINHOOD_USDG.eip712).toEqual({ name: 'Global Dollar', version: '1' })
	})

	it('keeps every registered asset at 6 decimals', () => {
		// creditsToUsdcBaseUnits() scales by 1e6 — a non-6dp asset would misprice.
		for (const n of Object.values(X402_NETWORKS)) {
			expect(n.assetDecimals).toBe(6)
		}
	})

	it('does not advertise extra networks unless opted in', () => {
		const nets = resolveX402Networks('base', BASE_USDC.asset, '')
		expect(nets).toHaveLength(1)
		expect(nets[0].network).toBe('base')
	})

	it('adds Robinhood Chain when opted in, keeping the primary first', () => {
		const nets = resolveX402Networks('base', BASE_USDC.asset, 'robinhood')
		expect(nets.map((n) => n.network)).toEqual(['base', 'robinhood'])
	})

	it('ignores unknown and duplicate network names instead of throwing', () => {
		const nets = resolveX402Networks('base', BASE_USDC.asset, 'nope, robinhood, robinhood, base')
		expect(nets.map((n) => n.network)).toEqual(['base', 'robinhood'])
	})

	it('falls back to the legacy USDC domain for an unregistered primary network', () => {
		const nets = resolveX402Networks('somechain', '0xabc', '')
		expect(nets[0].eip712).toEqual({ name: 'USD Coin', version: '2' })
		expect(nets[0].asset).toBe('0xabc')
	})

	it('honours an env override of the primary asset address', () => {
		const nets = resolveX402Networks('base', '0xTESTNETUSDC', '')
		expect(nets[0].asset).toBe('0xTESTNETUSDC')
		expect(nets[0].eip712).toEqual(BASE_USDC.eip712)
	})
})

describe('buildX402Challenge multi-network', () => {
	it('emits one accepts entry per enabled network, each with its own domain', () => {
		const ch = buildX402Challenge({ ...ENV, X402_EXTRA_NETWORKS: 'robinhood' }, OPTS)
		expect(ch.accepts).toHaveLength(2)

		const [base, hood] = ch.accepts
		expect(base.network).toBe('base')
		expect(base.extra).toEqual({ name: 'USD Coin', version: '2' })

		expect(hood.network).toBe('robinhood')
		expect(hood.asset).toBe(ROBINHOOD_USDG.asset)
		// The pre-registry code hardcoded USDC's domain for every entry — that
		// would make the USDG payload unsignable. Guard against a regression.
		expect(hood.extra).toEqual({ name: 'Global Dollar', version: '1' })
	})

	it('charges the same base-unit amount on every network (both assets are 6dp)', () => {
		const ch = buildX402Challenge({ ...ENV, X402_EXTRA_NETWORKS: 'robinhood' }, OPTS)
		const amounts = new Set(ch.accepts.map((a) => a.maxAmountRequired))
		expect(amounts.size).toBe(1)
	})

	it('stays single-network and unchanged when no extras are configured', () => {
		const ch = buildX402Challenge(ENV, OPTS)
		expect(ch.accepts).toHaveLength(1)
		expect(ch.accepts[0].network).toBe('base')
		expect(ch.accepts[0].extra).toEqual({ name: 'USD Coin', version: '2' })
	})
})
