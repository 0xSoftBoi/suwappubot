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
 *  POST /hackathon/world-id/verify   — poll for completion and verify the
 *                                      proof server-side; returns the nullifier
 *
 * The verify step blocks up to the IDKit poll timeout (5 min) — the demo
 * client should call it after the human scans the QR.
 *
 * OPENAPI TREATMENT: these routes are intentionally excluded from the public
 * OpenAPI spec (see app.ts mount comment). Demo surface, not public API.
 */

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { isInterceptaConfigured } from '../../../hackathon/tokyo2026/src/intercepta/client'
import { isTradingApiConfigured } from '../../../hackathon/tokyo2026/src/uniswap/tradingApi'
import { logger } from '../lib/logger'
import { interceptaEnabled, hackathonEnv, trustLayerEnabled } from '../hackathon/env'
import {
	awaitWorldIdGate,
	startWorldIdGate,
	worldIdReady,
	type TradeIntent,
} from '../hackathon/worldId'

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

hackathonRoutes.post('/world-id/verify', async (c) => {
	const env = hackathonEnv()
	if (!worldIdReady(env)) {
		return c.json({ error: 'World ID not configured' }, 503)
	}
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	const signal = typeof body?.['signal'] === 'string' ? (body['signal'] as string) : null
	if (!signal) return c.json({ error: 'missing required field: signal' }, 400)
	try {
		const res = await awaitWorldIdGate(signal)
		if (!res.ok) return c.json({ ok: false, reason: res.reason }, 200)
		return c.json({ ok: true, nullifier: res.nullifier })
	} catch (e) {
		logger.warn('[hackathon] world-id verify failed: %s', String(e))
		return c.json({ ok: false, reason: 'verification error' }, 502)
	}
})
