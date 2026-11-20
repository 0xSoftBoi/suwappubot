import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Context, Effect, Layer } from 'effect'
import { TokenService, TokenServiceLive, SOLANA_LIFI_CHAIN_ID } from '../services/TokenService'
import { QuoteRequestSchema } from '../routes/validators'

// Unit tests for the EVM<->Solana quote path (Li.Fi):
// - TokenService resolves Solana as chain 1151111081099710 (registry-only tokens)
// - /quote routes solana<->solana to Jupiter, everything else to Li.Fi
// - quote addresses are chain-appropriate per leg

const REAL_RUNTIME = { ...(await import('../runtime')) }

const runTestEffect = (effect: any) => Effect.runPromise(effect as Effect.Effect<any, any, never>)

mock.module('../runtime', () => ({
	runEffect: runTestEffect,
	runEffectEither: (effect: any) => runTestEffect(Effect.either(effect)),
	shutdownRuntime: async () => {},
}))

let classifyQuoteRoute: any
let resolveQuoteAddresses: any

beforeAll(async () => {
	;({ classifyQuoteRoute, resolveQuoteAddresses } = await import('../routes/agent'))
})

afterAll(() => {
	mock.module('../runtime', () => REAL_RUNTIME)
})

function getTokenService() {
	return Effect.runSync(
		Effect.scoped(
			Effect.map(Layer.build(TokenServiceLive), (ctx) => Context.get(ctx, TokenService)),
		),
	)
}
const tokenService = getTokenService()
const runResolve = (symbol: string, chainId: number) =>
	Effect.runPromise(tokenService.resolveToken(symbol, chainId))

const EVM_PLACEHOLDER = '0x0000000000000000000000000000000000000001'
const SOL_PLACEHOLDER = '11111111111111111111111111111111'
const SOL_WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const EVM_WALLET = '0x955808580ef8A9754CBdDf4f8466E9C041adCa15'

describe('TokenService Solana support', () => {
	it('resolves solana to Li.Fi chain id 1151111081099710', () => {
		const info = tokenService.resolveChain('solana')
		expect(info).not.toBeNull()
		expect(info!.id).toBe(SOLANA_LIFI_CHAIN_ID)
		expect(info!.id).toBe(1151111081099710)
		expect(info!.key).toBe('solana')
		expect(info!.nativeToken).toBe('SOL')
	})

	it("resolves the 'sol' alias too", () => {
		expect(tokenService.resolveChain('sol')!.id).toBe(1151111081099710)
	})

	it('resolves the numeric chain id string', () => {
		expect(tokenService.resolveChain('1151111081099710')!.key).toBe('solana')
	})

	it('getChainId maps solana without touching CHAINS', () => {
		expect(tokenService.getChainId('solana')).toBe(1151111081099710)
		expect(tokenService.getChainId('ethereum')).toBe(1)
	})

	it('leaves EVM resolution unchanged (regression)', () => {
		expect(tokenService.resolveChain('ethereum')!.id).toBe(1)
		expect(tokenService.resolveChain('base')!.id).toBe(8453)
		expect(tokenService.resolveChain('nope')).toBeNull()
	})

	it('resolves SOL from the Solana registry', async () => {
		const t = await runResolve('SOL', SOLANA_LIFI_CHAIN_ID)
		expect(t).not.toBeNull()
		expect(t!.address).toBe('So11111111111111111111111111111111111111112')
		expect(t!.decimals).toBe(9)
	})

	it('resolves USDC on Solana with 6 decimals', async () => {
		const t = await runResolve('USDC', SOLANA_LIFI_CHAIN_ID)
		expect(t).not.toBeNull()
		expect(t!.address).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
		expect(t!.decimals).toBe(6)
	})

	it('is case-insensitive on Solana symbols', async () => {
		const t = await runResolve('sol', SOLANA_LIFI_CHAIN_ID)
		expect(t!.address).toBe('So11111111111111111111111111111111111111112')
	})

	it('returns null for unknown Solana tokens (no Li.Fi fallback)', async () => {
		expect(await runResolve('FAKECOIN', SOLANA_LIFI_CHAIN_ID)).toBeNull()
	})

	it('still resolves EVM registry tokens (regression)', async () => {
		const t = await runResolve('ETH', 1)
		expect(t).not.toBeNull()
		expect(t!.decimals).toBe(18)
	})
})

describe('classifyQuoteRoute', () => {
	it('routes solana->solana to Jupiter', () => {
		expect(classifyQuoteRoute('solana', 'solana')).toBe('jupiter')
		expect(classifyQuoteRoute('sol', 'solana')).toBe('jupiter')
	})

	it('routes EVM->Solana to Li.Fi', () => {
		expect(classifyQuoteRoute('ethereum', 'solana')).toBe('lifi')
		expect(classifyQuoteRoute('base', 'solana')).toBe('lifi')
	})

	it('routes Solana->EVM to Li.Fi (previously fell into the Jupiter branch)', () => {
		expect(classifyQuoteRoute('solana', 'ethereum')).toBe('lifi')
	})

	it('routes EVM->EVM to Li.Fi (regression)', () => {
		expect(classifyQuoteRoute('ethereum', 'base')).toBe('lifi')
		expect(classifyQuoteRoute('base', undefined)).toBe('lifi')
	})

	it('keeps legacy source-only routing when no destination is given', () => {
		expect(classifyQuoteRoute('solana', undefined)).toBe('jupiter')
		expect(classifyQuoteRoute(undefined, undefined)).toBe('lifi')
	})
})

describe('resolveQuoteAddresses', () => {
	it('keeps the legacy same-address default on EVM<->EVM', () => {
		const r = resolveQuoteAddresses({
			fromIsSolana: false,
			toIsSolana: false,
			walletAddress: EVM_WALLET,
			toWalletAddress: undefined,
			agentMetadata: null,
		})
		expect(r).toEqual({ fromAddress: EVM_WALLET, toAddress: EVM_WALLET })
	})

	it('uses the EVM placeholder pair when nothing is provided', () => {
		const r = resolveQuoteAddresses({
			fromIsSolana: false,
			toIsSolana: false,
			walletAddress: undefined,
			toWalletAddress: undefined,
			agentMetadata: null,
		})
		expect(r).toEqual({ fromAddress: EVM_PLACEHOLDER, toAddress: EVM_PLACEHOLDER })
	})

	it('uses a Solana placeholder for the Solana leg on EVM->Solana', () => {
		const r = resolveQuoteAddresses({
			fromIsSolana: false,
			toIsSolana: true,
			walletAddress: undefined,
			toWalletAddress: undefined,
			agentMetadata: null,
		})
		expect(r).toEqual({ fromAddress: EVM_PLACEHOLDER, toAddress: SOL_PLACEHOLDER })
	})

	it('prefers the managed Solana wallet for the destination leg', () => {
		const r = resolveQuoteAddresses({
			fromIsSolana: false,
			toIsSolana: true,
			walletAddress: EVM_WALLET,
			toWalletAddress: undefined,
			agentMetadata: { wallet_address: EVM_WALLET, wallet_address_solana: SOL_WALLET },
		})
		expect(r).toEqual({ fromAddress: EVM_WALLET, toAddress: SOL_WALLET })
	})

	it('an explicit to_wallet_address always wins', () => {
		const r = resolveQuoteAddresses({
			fromIsSolana: false,
			toIsSolana: true,
			walletAddress: EVM_WALLET,
			toWalletAddress: SOL_WALLET,
			agentMetadata: { wallet_address_solana: 'other' },
		})
		expect(r).toEqual({ fromAddress: EVM_WALLET, toAddress: SOL_WALLET })
	})

	it('handles Solana->EVM with a Solana sender', () => {
		const r = resolveQuoteAddresses({
			fromIsSolana: true,
			toIsSolana: false,
			walletAddress: SOL_WALLET,
			toWalletAddress: undefined,
			agentMetadata: null,
		})
		expect(r).toEqual({ fromAddress: SOL_WALLET, toAddress: EVM_PLACEHOLDER })
	})
})

describe('QuoteRequestSchema', () => {
	it('accepts a Solana wallet_address', () => {
		const parsed = QuoteRequestSchema.safeParse({
			from_token: 'SOL',
			to_token: 'ETH',
			amount: '1',
			from_chain: 'solana',
			to_chain: 'ethereum',
			wallet_address: SOL_WALLET,
		})
		expect(parsed.success).toBe(true)
	})

	it('accepts to_wallet_address', () => {
		const parsed = QuoteRequestSchema.safeParse({
			from_token: 'ETH',
			to_token: 'SOL',
			amount: '0.1',
			from_chain: 'ethereum',
			to_chain: 'solana',
			wallet_address: EVM_WALLET,
			to_wallet_address: SOL_WALLET,
		})
		expect(parsed.success).toBe(true)
	})

	it('still rejects malformed addresses', () => {
		const parsed = QuoteRequestSchema.safeParse({
			from_token: 'ETH',
			to_token: 'SOL',
			amount: '0.1',
			from_chain: 'ethereum',
			to_chain: 'solana',
			wallet_address: 'not-an-address',
		})
		expect(parsed.success).toBe(false)
	})
})
