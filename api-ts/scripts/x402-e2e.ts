/**
 * x402 inline-settlement end-to-end verification script.
 *
 * MANUAL ONLY — do NOT wire this into CI. It performs a real signed on-chain
 * payment (EIP-3009 USDC authorization) against a live facilitator and, if
 * pointed at mainnet, moves real USDC out of PRIVATE_KEY's wallet. Run it by
 * hand against testnet first, and only against mainnet once you intend to
 * actually spend.
 *
 * What it does:
 *   1. Registers a fresh agent at BASE_URL (or reuses API_KEY if provided).
 *   2. Optionally burns any starter/free credits so the metered endpoint
 *      actually falls through to a 402 challenge (BURN_CREDITS=true).
 *   3. Calls the metered POST /v1/agent/quote endpoint via a fetch wrapped
 *      with @x402/fetch's wrapFetchWithPayment, which auto-handles the 402 by
 *      signing an EIP-3009 authorization with PRIVATE_KEY and retrying.
 *   4. Asserts the retried request comes back 200 with an
 *      X-Payment-Response header (the facilitator settlement receipt), and
 *      prints a clear PASS/FAIL.
 *
 * Required env:
 *   BASE_URL     e.g. https://devapi.suwappu.bot or http://localhost:8000
 *   PRIVATE_KEY  0x-prefixed EVM private key for a wallet holding USDC (and
 *                gas, if the asset transfer method isn't gasless) on NETWORK.
 *
 * Optional env:
 *   API_KEY        Reuse an existing agent's API key instead of registering.
 *   NETWORK        base | base-sepolia | polygon | arbitrum (default: base)
 *   BURN_CREDITS   'true' to spend down free/starter credits first so the
 *                  facilitator path is actually exercised (default: false)
 *
 * Usage:
 *   BASE_URL=https://devapi.suwappu.bot \
 *   PRIVATE_KEY=0xabc... \
 *   NETWORK=base-sepolia \
 *   BURN_CREDITS=true \
 *   bun run scripts/x402-e2e.ts
 */

import { wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm'
import { type Chain, arbitrum, base, baseSepolia, polygon } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const BASE_URL = process.env.BASE_URL
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
let API_KEY = process.env.API_KEY
const NETWORK = process.env.NETWORK ?? 'base'
const BURN_CREDITS = process.env.BURN_CREDITS === 'true'

const NETWORKS: Record<string, Chain> = {
	base,
	'base-sepolia': baseSepolia,
	polygon,
	arbitrum,
}

function fail(msg: string): never {
	console.error(`[x402-e2e] FAIL: ${msg}`)
	process.exit(1)
}

async function main() {
	if (!BASE_URL) fail('BASE_URL is required')
	if (!PRIVATE_KEY) fail('PRIVATE_KEY is required')
	const chain = NETWORKS[NETWORK]
	if (!chain) fail(`Unknown NETWORK "${NETWORK}" — expected one of ${Object.keys(NETWORKS).join(', ')}`)

	const account = privateKeyToAccount(PRIVATE_KEY)
	console.log(`[x402-e2e] Using wallet ${account.address} on ${NETWORK} (chainId ${chain.id})`)

	if (!API_KEY) {
		console.log('[x402-e2e] No API_KEY provided — registering a fresh agent...')
		const res = await fetch(`${BASE_URL}/v1/agent/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: `x402-e2e-${Date.now()}`, description: 'x402 e2e script' }),
		})
		const body = (await res.json()) as {
			success?: boolean
			agent?: { api_key?: string }
			error?: string
		}
		if (!res.ok || !body.success || !body.agent?.api_key) {
			fail(`agent registration failed: ${res.status} ${JSON.stringify(body)}`)
		}
		API_KEY = body.agent?.api_key
		console.log('[x402-e2e] Registered agent, got API key.')
	}

	const quoteBody = JSON.stringify({
		from_token: 'ETH',
		to_token: 'USDC',
		amount: '0.001',
		chain: NETWORK === 'base-sepolia' ? 'base' : NETWORK,
	})

	// wrapFetchWithPayment calls this fetch a SECOND time on retry with a Request
	// object that already carries the signed X-PAYMENT header and no separate
	// `init`. Passing `init.headers` in that call would REPLACE the Request's
	// headers wholesale and silently drop X-PAYMENT, so the retry would always
	// 402 again. Build a Request first and mutate its headers in place instead.
	const plainFetch: typeof fetch = (input, init) => {
		const req = new Request(input, init)
		req.headers.set('Authorization', `Bearer ${API_KEY}`)
		if (!req.headers.has('Content-Type')) req.headers.set('Content-Type', 'application/json')
		return fetch(req)
	}

	if (BURN_CREDITS) {
		console.log('[x402-e2e] BURN_CREDITS=true — spending down credits until a 402 shows up...')
		for (let i = 0; i < 200; i++) {
			const r = await plainFetch(`${BASE_URL}/v1/agent/quote`, { method: 'POST', body: quoteBody })
			if (r.status === 402) {
				console.log(`[x402-e2e] Got 402 after ${i} calls — credits exhausted.`)
				break
			}
			if (!r.ok) fail(`unexpected non-402/200 status while burning credits: ${r.status}`)
			if (i === 199) fail('did not exhaust credits after 200 calls — check AGENT_METERING_ENABLED')
		}
	}

	// Sanity: confirm we actually get a 402 before wrapping — otherwise a pass
	// below would just mean "had enough credits", not "facilitator settle works".
	const precheck = await plainFetch(`${BASE_URL}/v1/agent/quote`, { method: 'POST', body: quoteBody })
	if (precheck.status !== 402) {
		fail(
			`expected 402 before x402 payment (got ${precheck.status}) — agent still has credits; ` +
				're-run with BURN_CREDITS=true or use an API_KEY with no balance',
		)
	}
	console.log('[x402-e2e] Confirmed 402 challenge. Wrapping fetch with x402 payment client...')

	const client = new x402Client().register(`eip155:${chain.id}`, new ExactEvmScheme(account))
	const fetchWithPay = wrapFetchWithPayment(plainFetch, client)

	const res = await fetchWithPay(`${BASE_URL}/v1/agent/quote`, { method: 'POST', body: quoteBody })
	const paymentResponseHeader = res.headers.get('X-Payment-Response') ?? res.headers.get('x-payment-response')

	if (res.status !== 200) {
		const text = await res.text().catch(() => '<unreadable>')
		fail(`expected 200 after x402 payment retry, got ${res.status}: ${text}`)
	}
	if (!paymentResponseHeader) {
		fail('response was 200 but missing X-Payment-Response header — settlement receipt not surfaced')
	}

	console.log('[x402-e2e] PASS: 200 OK with X-Payment-Response header present.')
	console.log(`[x402-e2e] X-Payment-Response: ${paymentResponseHeader}`)
}

main().catch((e) => {
	fail(e instanceof Error ? e.stack || e.message : String(e))
})
