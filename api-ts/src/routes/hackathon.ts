/**
 * HACKATHON (ETHGlobal Tokyo 2026) — trust-layer demo routes.
 *
 * Mounted at /hackathon ONLY when HACKATHON_TRUST_LAYER=true (see app.ts).
 * Unmounted by default: the surface doesn't exist unless explicitly enabled.
 *
 *  GET  /hackathon/status            — which trust-layer providers are live
 *  POST /hackathon/world-id/start    — begin a World ID guardian-gate
 *                                      verification for a trade intent;
 *                                      returns the QR connectorURI + signal
 *  POST /hackathon/world-id/verify   — short long-poll (<=25s) for the
 *                                      background verification kicked off by
 *                                      /start; returns pending/verified/failed
 *  GET  /hackathon/evidence          — live Sepolia ENS + tx receipt evidence
 *                                      for the demo UI (60s cache, never throws)
 *
 * /world-id/start kicks off the IDKit poll + server-side proof verification
 * in the background (result keyed by signal, ~10min TTL) so no single request
 * blocks past Cloudflare's ~100s proxy timeout. The demo client polls
 * /world-id/verify repeatedly after displaying the QR from /start.
 *
 * OPENAPI TREATMENT: these routes are intentionally excluded from the public
 * OpenAPI spec (see app.ts mount comment). Demo surface, not public API.
 */

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { isInterceptaConfigured } from '../hackathon/tokyo2026/intercepta/client'
import { isTradingApiConfigured } from '../hackathon/tokyo2026/uniswap/tradingApi'
import { logger } from '../lib/logger'
import { interceptaEnabled, hackathonEnv, trustLayerEnabled } from '../hackathon/env'
import {
	pollWorldIdGate,
	startWorldIdGate,
	worldIdReady,
	type TradeIntent,
} from '../hackathon/worldId'
import { getEvidence } from '../hackathon/tokyo2026/evidence'
import {
	getPassport,
	getSwapJob,
	isValidWallet,
	pollPassportGate,
	startPassportGate,
	startPassportSwap,
} from '../hackathon/passport'

export const hackathonRoutes = new Hono()

hackathonRoutes.get('/status', (c) => {
	const env = hackathonEnv()
	return c.json({
		trustLayer: trustLayerEnabled(env),
		providers: {
			worldId: worldIdReady(env),
			intercepta: interceptaEnabled(env) && isInterceptaConfigured(),
			uniswap: isTradingApiConfigured(),
			ensv2: Boolean(env.SEPOLIA_RPC_URL),
		},
	})
})

hackathonRoutes.post('/world-id/start', async (c) => {
	const env = hackathonEnv()
	if (!worldIdReady(env)) {
		return c.json({ error: 'World ID not configured — set WORLD_APP_ID / WORLD_RP_ID / RP_SIGNING_KEY' }, 503)
	}
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	const agentId = typeof body?.['agentId'] === 'string' ? (body['agentId'] as string) : null
	const chain = typeof body?.['chain'] === 'string' ? (body['chain'] as string) : null
	const fromToken = typeof body?.['fromToken'] === 'string' ? (body['fromToken'] as string) : null
	const toToken = typeof body?.['toToken'] === 'string' ? (body['toToken'] as string) : null
	const amountIn = typeof body?.['amountIn'] === 'string' ? (body['amountIn'] as string) : null
	const summary = typeof body?.['summary'] === 'string' ? (body['summary'] as string) : 'trade verification'
	if (!agentId || !chain || !fromToken || !toToken || !amountIn) {
		return c.json(
			{ error: 'missing required fields: agentId, chain, fromToken, toToken, amountIn' },
			400,
		)
	}
	// Nonce is server-issued per verification — the agent never picks it, so a
	// captured intent can't be replayed as a fresh approval.
	const intent: TradeIntent = {
		agentId,
		chain,
		fromToken,
		toToken,
		amountIn,
		summary,
		nonce: randomUUID(),
	}
	// stepUp: true requests the step-up action (distinct nullifier namespace)
	// for re-verifications after a hold — the client never picks the action.
	const stepUp = body?.['stepUp'] === true
	try {
		const { connectorURI, signal } = await startWorldIdGate(intent, stepUp)
		return c.json({ connectorURI, signal, stepUp })
	} catch (e) {
		logger.warn('[hackathon] world-id start failed: %s', String(e))
		return c.json({ error: 'failed to start World ID verification' }, 502)
	}
})

// Short long-poll: /world-id/start already kicked off await+verify in the
// background (see hackathon/worldId.ts), so this just polls the in-memory
// result — never blocks past ~25s, well under Cloudflare's ~100s proxy
// timeout. The client is expected to call this repeatedly until it gets a
// terminal (verified/failed) status; each call is idempotent.
const VERIFY_POLL_BUDGET_MS = 25_000
const VERIFY_POLL_INTERVAL_MS = 1_000

hackathonRoutes.post('/world-id/verify', async (c) => {
	const env = hackathonEnv()
	if (!worldIdReady(env)) {
		return c.json({ error: 'World ID not configured' }, 503)
	}
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	const signal = typeof body?.['signal'] === 'string' ? (body['signal'] as string) : null
	if (!signal) return c.json({ error: 'missing required field: signal' }, 400)

	const deadline = Date.now() + VERIFY_POLL_BUDGET_MS
	for (;;) {
		const res = pollWorldIdGate(signal)
		if (res.status !== 'pending') {
			return c.json(res, 200)
		}
		if (Date.now() >= deadline) {
			return c.json(res, 200)
		}
		await new Promise((r) => setTimeout(r, VERIFY_POLL_INTERVAL_MS))
	}
})

// -----------------------------------------------------------------------
// Agent Swap Passport (see api-ts/src/hackathon/passport.ts): server-driven
// World ID gate → idempotent ENS mint + hook allowlist → gated Sepolia swap.
// Same non-blocking start/verify polling contract as /world-id/*.
// -----------------------------------------------------------------------

function parseWallet(body: unknown): string | null {
	const wallet = (body as Record<string, unknown> | null)?.['wallet']
	if (!isValidWallet(wallet)) return null
	return (wallet as string).toLowerCase()
}

hackathonRoutes.post('/passport/start', async (c) => {
	const env = hackathonEnv()
	if (!worldIdReady(env)) {
		return c.json({ error: 'World ID not configured' }, 503)
	}
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	const wallet = parseWallet(body)
	if (!wallet) return c.json({ error: 'missing or invalid field: wallet (0x + 40 hex chars)' }, 400)
	try {
		const { connectorURI, signal } = await startPassportGate(wallet)
		return c.json({
			connectorURI,
			signal,
			simulatorUrl: 'https://simulator.worldcoin.org/?uri=' + encodeURIComponent(connectorURI),
		})
	} catch (e) {
		logger.warn('[hackathon] passport start failed: %s', String(e))
		return c.json({ error: 'failed to start passport verification' }, 502)
	}
})

const PASSPORT_VERIFY_POLL_BUDGET_MS = 25_000
const PASSPORT_VERIFY_POLL_INTERVAL_MS = 1_000

hackathonRoutes.post('/passport/verify', async (c) => {
	const env = hackathonEnv()
	if (!worldIdReady(env)) {
		return c.json({ error: 'World ID not configured' }, 503)
	}
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	const signal = typeof body?.['signal'] === 'string' ? (body['signal'] as string) : null
	if (!signal) return c.json({ error: 'missing required field: signal' }, 400)

	const deadline = Date.now() + PASSPORT_VERIFY_POLL_BUDGET_MS
	for (;;) {
		const res = pollPassportGate(signal)
		if (res.status !== 'pending' && res.status !== 'provisioning') {
			return c.json(res, 200)
		}
		if (Date.now() >= deadline) {
			return c.json(res, 200)
		}
		await new Promise((r) => setTimeout(r, PASSPORT_VERIFY_POLL_INTERVAL_MS))
	}
})

hackathonRoutes.post('/passport/swap', async (c) => {
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	const wallet = parseWallet(body)
	if (!wallet) return c.json({ error: 'missing or invalid field: wallet (0x + 40 hex chars)' }, 400)
	try {
		const result = await startPassportSwap(wallet)
		if (result.status === 'rejected') {
			return c.json({ error: result.error }, 429)
		}
		return c.json(result, result.status === 'blocked' ? 200 : 202)
	} catch (e) {
		logger.warn('[hackathon] passport swap failed: %s', String(e))
		return c.json({ error: 'failed to start passport swap' }, 502)
	}
})

hackathonRoutes.get('/passport/swap/:jobId', (c) => {
	const jobId = c.req.param('jobId')
	return c.json(getSwapJob(jobId))
})

hackathonRoutes.get('/passport/:wallet', async (c) => {
	const wallet = c.req.param('wallet')
	if (!isValidWallet(wallet)) {
		return c.json({ error: 'invalid wallet (0x + 40 hex chars)' }, 400)
	}
	try {
		const record = await getPassport(wallet.toLowerCase())
		return c.json(record)
	} catch (e) {
		logger.warn('[hackathon] passport read failed: %s', String(e))
		return c.json({ error: 'passport temporarily unavailable' }, 502)
	}
})

hackathonRoutes.get('/evidence', async (c) => {
	try {
		const evidence = await getEvidence()
		return c.json(evidence)
	} catch (e) {
		// getEvidence() is designed never to throw; this is a last-resort
		// safety net so the demo page never sees a 500 from this endpoint.
		logger.warn('[hackathon] evidence route failed: %s', String(e))
		return c.json({ error: 'evidence temporarily unavailable' }, 502)
	}
})
