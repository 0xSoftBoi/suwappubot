import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	loadInterceptaConfig,
	resolveChainId,
	scanAddress,
	scanToken,
	scanTransaction,
	type InterceptaConfig,
} from '../src/intercepta/client.ts'

const cfg: InterceptaConfig = { apiKey: 'test-key', baseUrl: 'https://api.web3antivirus.io', timeoutMs: 1000 }

let lastUrl = ''
let lastInit: any = null
let nextJson: any = {}
let nextStatus = 200

const realFetch = globalThis.fetch

beforeEach(() => {
	lastUrl = ''
	lastInit = null
	nextJson = {}
	nextStatus = 200
	globalThis.fetch = (async (url: any, init: any) => {
		lastUrl = String(url)
		lastInit = init
		return new Response(JSON.stringify(nextJson), {
			status: nextStatus,
			headers: { 'Content-Type': 'application/json' },
		})
	}) as any
})

afterEach(() => {
	globalThis.fetch = realFetch
})

describe('loadInterceptaConfig', () => {
	test('defaults to the W3A base URL', () => {
		const c = loadInterceptaConfig({ INTERCEPTA_API_KEY: 'k' } as any)
		expect(c.baseUrl).toBe('https://api.web3antivirus.io')
	})
	test('throws without a key', () => {
		expect(() => loadInterceptaConfig({} as any)).toThrow('INTERCEPTA_API_KEY')
	})
})

describe('resolveChainId', () => {
	test('maps aliases and passes numeric ids through', () => {
		expect(resolveChainId('base')).toBe('8453')
		expect(resolveChainId('Ethereum')).toBe('1')
		expect(resolveChainId('137')).toBe('137')
		expect(resolveChainId(undefined)).toBe('1')
	})
	test('throws on unknown aliases', () => {
		expect(() => resolveChainId('sepolia')).toThrow('unsupported chain')
	})
})

describe('scanAddress (quick-scan)', () => {
	test('malicious trait + high toxicScore → malicious', async () => {
		nextJson = {
			toxicScore: 82,
			traits: [{ risk: 90, name: 'known_scammer', txsCount: 12, description: 'Known scammer wallet' }],
		}
		const r = await scanAddress(cfg, '0xdead')
		expect(lastUrl).toBe('https://api.web3antivirus.io/api/public/v2/extension/account/0xdead/quick-scan')
		expect(lastInit.method).toBe('GET')
		expect(lastInit.headers['X-API-KEY']).toBe('test-key')
		expect(r.verdict).toBe('malicious')
		expect(r.riskScore).toBe(82)
		expect(r.findings[0]!.code).toBe('known_scammer')
		expect(r.findings[0]!.risk).toBe('CRITICAL')
	})
	test('clean address → safe', async () => {
		nextJson = { toxicScore: 3, traits: [] }
		const r = await scanAddress(cfg, '0xclean')
		expect(r.verdict).toBe('safe')
		expect(r.riskScore).toBe(3)
		expect(r.findings).toEqual([])
	})
	test('unrecognized payload fails closed → suspicious', async () => {
		nextJson = { somethingElse: true }
		const r = await scanAddress(cfg, '0xweird')
		expect(r.verdict).toBe('suspicious')
		expect(r.findings[0]!.code).toBe('unrecognized_payload')
	})
})

describe('scanToken (token risks)', () => {
	test('malicious category + HONEYPOT detector → malicious', async () => {
		nextJson = {
			apiVersion: 'v2',
			riskScore: 97,
			riskLevel: 'high',
			category: 'malicious',
			trust: 'blocklist',
			action: 'block',
			detectors: [{ code: 'HONEYPOT', description: 'Cannot be sold' }],
			token: { chainId: 8453, address: '0xtok', symbol: 'SCAM' },
		}
		const r = await scanToken(cfg, '0xtok', 'base')
		expect(lastUrl).toBe(
			'https://api.web3antivirus.io/api/public/v2/extension/token-intelligence/token/0xtok/risks?chainId=8453',
		)
		expect(r.verdict).toBe('malicious')
		expect(r.riskScore).toBe(97)
		expect(r.findings[0]!.risk).toBe('CRITICAL')
	})
	test('low risk token → safe', async () => {
		nextJson = {
			riskScore: 8,
			riskLevel: 'low',
			category: 'unverified',
			trust: 'neutral',
			action: 'info',
			detectors: [],
			token: { chainId: 1, address: '0xok', symbol: 'OK' },
		}
		const r = await scanToken(cfg, '0xok', '1')
		expect(r.verdict).toBe('safe')
	})
	test('unrecognized payload fails closed → suspicious', async () => {
		nextJson = { nope: 1 }
		const r = await scanToken(cfg, '0xweird', '1')
		expect(r.verdict).toBe('suspicious')
	})
})

describe('scanTransaction (simulation)', () => {
	test('WALLET_DRAINER detector → malicious', async () => {
		nextJson = {
			from: '0xagent',
			to: '0xdrain',
			detectors: [{ code: 'WALLET_DRAINER', description: 'Drains wallet funds' }],
			transactionType: 'other',
		}
		const r = await scanTransaction(cfg, { from: '0xagent', to: '0xdrain', chain: '1' })
		expect(lastUrl).toBe('https://api.web3antivirus.io/api/public/v1/extension/simulation/transaction?chainId=1')
		expect(lastInit.method).toBe('POST')
		const body = JSON.parse(lastInit.body)
		expect(body.to).toBe('0xdrain')
		expect(body.mode).toBe('short')
		expect(r.verdict).toBe('malicious')
		expect(r.riskScore).toBe(85)
		expect(r.findings[0]!.code).toBe('WALLET_DRAINER')
	})
	test('no detectors → safe', async () => {
		nextJson = { from: '0xagent', to: '0xrouter', detectors: [], transactionType: 'other' }
		const r = await scanTransaction(cfg, { to: '0xrouter', chain: '1' })
		expect(r.verdict).toBe('safe')
		expect(r.riskScore).toBe(5)
	})
	test('suspicious-only detector → suspicious', async () => {
		nextJson = {
			detectors: [{ code: 'SUSPICIOUS_APPROVE', description: 'Suspicious approval pattern' }],
		}
		const r = await scanTransaction(cfg, { to: '0xrouter', chain: '1' })
		expect(r.verdict).toBe('suspicious')
		expect(r.riskScore).toBe(60)
	})
})
