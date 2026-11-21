import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from '@x402/core/http'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import type {
	PaymentPayload,
	PaymentRequired,
	PaymentRequirements,
	SettleResponse,
} from '@x402/core/types'
import { isBatchSettlementRefundPayload } from '@x402/evm'
import {
	type BatchSettlementChannelManager,
	BatchSettlementEvmScheme,
} from '@x402/evm/batch-settlement/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar'
import { privateKeyToAccount } from 'viem/accounts'
import { findX402Network, resolveX402Networks, type X402Network } from '../config/x402Networks'
import { logger } from '../lib/logger'
import { holdSettlementLease, PostgresChannelStorage } from '../lib/x402ChannelStorage'
import { crossCheckSignedRequirements, resolveFacilitatorConfig } from './FacilitatorService'

/**
 * x402 v2 resource server — the single place Suwappu speaks x402.
 *
 * Built on @x402/core's `x402ResourceServer` so we get the v2 wire format
 * (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE headers, CAIP-2
 * networks, `resource` object, `amount` field) and every scheme's
 * verify/settle hooks for free instead of hand-rolling them.
 *
 * Schemes registered:
 *   - `exact`            — one EIP-3009 transfer per call (every enabled network).
 *   - `batch-settlement` — payment channels: agent deposits once, then each call
 *                          is a signed cumulative voucher verified locally (no
 *                          chain hop, ~0 marginal cost). A channel manager claims
 *                          many vouchers in one tx and sweeps to the collector.
 *                          This is the rail high-frequency agents should use.
 *
 * Extensions: Bazaar discovery, so the agent surface is indexed by x402
 * discovery crawlers.
 *
 * MONEY-PATH. Everything here decides whether a request is paid.
 */

export type X402ServiceEnv = {
	AGENT_METERING_COLLECTOR_ADDRESS?: string
	FEE_WALLET_EVM: string
	AGENT_METERING_NETWORK: string
	AGENT_METERING_USDC_ADDRESS: string
	X402_EXTRA_NETWORKS?: string
	X402_FACILITATOR_ENABLED?: string
	X402_FACILITATOR_URL: string
	X402_FACILITATOR_API_KEY?: string
	CDP_API_KEY_ID?: string
	CDP_API_KEY_SECRET?: string
	X402_BATCH_SETTLEMENT_ENABLED?: string
	X402_BATCH_NETWORKS?: string
	X402_RECEIVER_AUTHORIZER_PK?: string
	X402_BATCH_WITHDRAW_DELAY_SECS?: string
	X402_BATCH_WORKER_ENABLED?: string
	X402_BATCH_CLAIM_INTERVAL_SECS?: string
	X402_BATCH_SETTLE_INTERVAL_SECS?: string
	X402_BATCH_REFUND_IDLE_SECS?: string
	X402_PUBLIC_ORIGIN?: string
}

export const X402_VERSION = 2 as const

type Runtime = {
	server: x402ResourceServer
	facilitator: HTTPFacilitatorClient
	networks: X402Network[]
	batchNetworks: X402Network[]
	batchScheme?: BatchSettlementEvmScheme
	managers: BatchSettlementChannelManager[]
	collector: `0x${string}`
	initialized: boolean
	initError?: string
}

let runtime: Promise<Runtime> | null = null

export const collectorOf = (
	env: Pick<X402ServiceEnv, 'AGENT_METERING_COLLECTOR_ADDRESS' | 'FEE_WALLET_EVM'>,
) => (env.AGENT_METERING_COLLECTOR_ADDRESS || env.FEE_WALLET_EVM) as `0x${string}`

export const isBatchEnabled = (env: X402ServiceEnv) =>
	env.X402_BATCH_SETTLEMENT_ENABLED === 'true' &&
	env.X402_FACILITATOR_ENABLED === 'true' &&
	!!env.X402_RECEIVER_AUTHORIZER_PK?.trim()

function resolveBatchNetworks(env: X402ServiceEnv, enabled: X402Network[]): X402Network[] {
	if (!isBatchEnabled(env)) return []
	const out: X402Network[] = []
	for (const raw of (env.X402_BATCH_NETWORKS || 'base').split(',')) {
		const n = findX402Network(raw)
		// Only offer batch on a network we already accept payment on.
		const live = n && enabled.find((e) => e.network === n.network)
		if (live && !out.includes(live)) out.push(live)
	}
	return out
}

async function build(env: X402ServiceEnv): Promise<Runtime> {
	const networks = resolveX402Networks(
		env.AGENT_METERING_NETWORK,
		env.AGENT_METERING_USDC_ADDRESS,
		env.X402_EXTRA_NETWORKS,
	).filter((n) => n.chainId > 0)
	const collector = collectorOf(env)
	const facilitator = new HTTPFacilitatorClient(resolveFacilitatorConfig(env))
	const server = new x402ResourceServer(facilitator)

	const exact = new ExactEvmScheme()
	for (const n of networks) server.register(n.caip2, exact)

	const pk = env.X402_RECEIVER_AUTHORIZER_PK?.trim()
	// The receiverAuthorizer is committed into every channel's config, so it must
	// be a STABLE key we own. Facilitators (incl. x402.org) may not advertise one,
	// and initialize() then fails for every scheme — so batch is only registered
	// when we hold the key. Without it: exact-only, loudly.
	let batchNetworks = resolveBatchNetworks(env, networks)
	if (batchNetworks.length > 0 && !pk) {
		logger.error(
			'[x402] X402_BATCH_SETTLEMENT_ENABLED=true but X402_RECEIVER_AUTHORIZER_PK is unset — batch-settlement disabled',
		)
		batchNetworks = []
	}
	let batchScheme: BatchSettlementEvmScheme | undefined
	if (batchNetworks.length > 0) {
		batchScheme = new BatchSettlementEvmScheme(collector, {
			voucherStoreMode: 'self',
			storage: new PostgresChannelStorage(),
			receiverAuthorizerSigner: privateKeyToAccount(pk as `0x${string}`),
			withdrawDelay: Number(env.X402_BATCH_WITHDRAW_DELAY_SECS || 86400),
			// Reject deposits too small to be worth a claim tx.
			enforceMinDeposit: true,
		})
		for (const n of batchNetworks) server.register(n.caip2, batchScheme)
	}

	server.registerExtension(bazaarResourceServerExtension)

	const rt: Runtime = {
		server,
		facilitator,
		networks,
		batchNetworks,
		batchScheme,
		managers: [],
		collector,
		initialized: false,
	}

	try {
		// Pulls /supported from the facilitator — needed so batch requirements can
		// be enriched with receiverAuthorizer / withdrawDelay.
		await server.initialize()
		rt.initialized = true
	} catch (e) {
		rt.initError = e instanceof Error ? e.message : String(e)
		logger.error(
			{ err: rt.initError },
			'[x402] resource server initialize() failed — exact-only fallback challenge',
		)
	}

	if (rt.initialized && batchScheme && env.X402_BATCH_WORKER_ENABLED !== 'false') {
		for (const n of batchNetworks) {
			try {
				const mgr = batchScheme.createChannelManager(facilitator, n.caip2, n.asset as `0x${string}`)
				mgr.start({
					claimIntervalSecs: Number(env.X402_BATCH_CLAIM_INTERVAL_SECS || 60),
					settleIntervalSecs: Number(env.X402_BATCH_SETTLE_INTERVAL_SECS || 300),
					refundIntervalSecs: 3600,
					maxClaimsPerBatch: 100,
					// Only the lease holder submits on-chain claim/settle/refund txs.
					selectClaimChannels: async (chs) => ((await holdSettlementLease()) ? chs : []),
					shouldSettle: () => holdSettlementLease(),
					selectRefundChannels: async (chs, ctx) => {
						if (!(await holdSettlementLease())) return []
						const idleMs = Number(env.X402_BATCH_REFUND_IDLE_SECS || 86400) * 1000
						return chs.filter((c) => ctx.now - c.lastRequestTimestamp >= idleMs)
					},
					onClaim: (r) => logger.info({ network: n.caip2, ...r }, '[x402] batch claim'),
					onSettle: (r) => logger.info({ network: n.caip2, ...r }, '[x402] batch settle'),
					onRefund: (r) => logger.info({ network: n.caip2, ...r }, '[x402] batch refund'),
					onError: (err) =>
						logger.error(
							{ network: n.caip2, err: err instanceof Error ? err.message : String(err) },
							'[x402] batch worker error',
						),
				})
				rt.managers.push(mgr)
				logger.info({ network: n.caip2 }, '[x402] batch-settlement channel manager started')
			} catch (e) {
				logger.error({ network: n.caip2, err: String(e) }, '[x402] failed to start channel manager')
			}
		}
	}
	return rt
}

/** Lazy, process-wide resource server. A failed build is retried next call. */
export function getX402Runtime(env: X402ServiceEnv): Promise<Runtime> {
	if (!runtime) {
		runtime = build(env).catch((e) => {
			runtime = null
			throw e
		})
	}
	return runtime
}

/** Flush unclaimed vouchers on shutdown so a redeploy never strands money. */
export async function shutdownX402(): Promise<void> {
	if (!runtime) return
	const rt = await runtime.catch(() => null)
	if (!rt) return
	await Promise.allSettled(rt.managers.map((m) => m.stop({ flush: true })))
}

/** Absolute resource URL (v2 requires `resource.url`). */
export function resourceUrl(env: X402ServiceEnv, path: string): string {
	if (/^https?:\/\//.test(path)) return path
	const origin = (env.X402_PUBLIC_ORIGIN || 'https://api.suwappu.bot').replace(/\/+$/, '')
	return `${origin}${path.startsWith('/') ? '' : '/'}${path}`
}

export type ChallengeOpts = {
	amount: string // atomic units (6-dp stablecoin)
	resource: string
	description: string
	error?: string
	/** Present when we are answering a failed/corrective payment attempt. */
	paymentPayload?: PaymentPayload
}

/**
 * Static v2 requirements (no facilitator round-trip). Used as the fallback and
 * as the `baseline` the SDK's enrichers extend. One `exact` entry per network,
 * then one `batch-settlement` entry per batch network.
 */
export function staticRequirements(env: X402ServiceEnv, amount: string): PaymentRequirements[] {
	const collector = collectorOf(env)
	const networks = resolveX402Networks(
		env.AGENT_METERING_NETWORK,
		env.AGENT_METERING_USDC_ADDRESS,
		env.X402_EXTRA_NETWORKS,
	)
	const exact: PaymentRequirements[] = networks.map((n) => ({
		scheme: 'exact',
		network: n.caip2,
		amount,
		asset: n.asset,
		payTo: collector,
		maxTimeoutSeconds: 120,
		// EIP-712 domain for EIP-3009 transferWithAuthorization.
		extra: { ...n.eip712 },
	}))
	const batch: PaymentRequirements[] = resolveBatchNetworks(env, networks).map((n) => ({
		scheme: 'batch-settlement',
		network: n.caip2,
		amount,
		asset: n.asset,
		payTo: collector,
		maxTimeoutSeconds: 120,
		extra: { ...n.eip712 },
	}))
	return [...exact, ...batch]
}

/** Bazaar discovery metadata for the metered agent surface. */
export function discoveryExtensionFor(resource: string): Record<string, unknown> {
	try {
		return declareDiscoveryExtension({
			input: {},
			output: { example: { success: true } },
		}) as Record<string, unknown>
	} catch {
		return {}
	}
}

/**
 * Build the full v2 PaymentRequired. Goes through the SDK so each scheme can
 * enrich its entries (batch-settlement adds receiverAuthorizer, withdrawDelay,
 * minDeposit, and — on a cumulative mismatch — the corrective channel state the
 * client needs to resync). Falls back to the static requirements if the
 * facilitator is unreachable, so a 402 is ALWAYS returned.
 */
export async function buildPaymentRequired(
	env: X402ServiceEnv,
	opts: ChallengeOpts,
): Promise<PaymentRequired> {
	const resource = {
		url: resourceUrl(env, opts.resource),
		description: opts.description,
		mimeType: 'application/json',
		serviceName: 'Suwappu',
		tags: ['defi', 'swap', 'cross-chain', 'agents'],
	}
	const baseline = staticRequirements(env, opts.amount)
	const fallback: PaymentRequired = {
		x402Version: X402_VERSION,
		error: opts.error,
		resource,
		accepts: baseline.filter((r) => r.scheme === 'exact'),
	}
	if (env.X402_FACILITATOR_ENABLED !== 'true') return fallback
	try {
		const rt = await getX402Runtime(env)
		if (!rt.initialized) return fallback
		const reqs: PaymentRequirements[] = []
		for (const r of baseline) {
			if (!rt.server.hasRegisteredScheme(r.network as `${string}:${string}`, r.scheme)) continue
			if (!rt.server.getSupportedKind(X402_VERSION, r.network as `${string}:${string}`, r.scheme))
				continue
			const built = await rt.server.buildPaymentRequirements({
				scheme: r.scheme,
				network: r.network as `${string}:${string}`,
				payTo: r.payTo,
				price: { amount: r.amount, asset: r.asset, extra: r.extra },
				maxTimeoutSeconds: r.maxTimeoutSeconds,
			})
			reqs.push(...built)
		}
		if (reqs.length === 0) return fallback
		return await rt.server.createPaymentRequiredResponse(
			reqs,
			resource,
			opts.error,
			discoveryExtensionFor(opts.resource),
			undefined,
			opts.paymentPayload,
		)
	} catch (e) {
		logger.warn(
			{ err: e instanceof Error ? e.message : String(e) },
			'[x402] enriched challenge failed — static fallback',
		)
		return fallback
	}
}

export type X402SettleResult =
	| {
			ok: true
			scheme: string
			network: string
			payer?: string
			txHash?: string
			/** base64 PAYMENT-RESPONSE header value. */
			responseHeader: string
			settle: SettleResponse
	  }
	| { ok: false; error: string; payload?: PaymentPayload }

/** Decode a PAYMENT-SIGNATURE (or legacy X-PAYMENT) header. */
export function decodePayment(header: string): PaymentPayload | null {
	try {
		return decodePaymentSignatureHeader(header)
	} catch {
		return null
	}
}

/**
 * Verify + settle one call's payment against what we advertised.
 *
 * - exact: verify signature → settle the EIP-3009 transfer on-chain.
 * - batch-settlement: deposit payloads open/top-up a channel (on-chain via the
 *   facilitator); voucher payloads are verified locally by ECDSA recovery and
 *   "settled" by committing the new cumulative charge to the channel store —
 *   the actual on-chain claim happens later, batched, in the channel manager.
 *
 * Never throws.
 */
export async function verifyAndSettle(
	env: X402ServiceEnv,
	header: string,
	accepts: PaymentRequirements[],
	opts: {
		/**
		 * The address risk screening cleared. When set, the facilitator/scheme-
		 * verified payer MUST equal it (case-insensitive) or we refuse to settle —
		 * otherwise a client could get one address screened and pay from another.
		 */
		expectedPayer?: string
	} = {},
): Promise<X402SettleResult> {
	if (env.X402_FACILITATOR_ENABLED !== 'true') return { ok: false, error: 'facilitator_disabled' }
	const payload = decodePayment(header)
	if (!payload) return { ok: false, error: 'invalid_payment_header' }
	if (payload.x402Version !== X402_VERSION)
		return { ok: false, error: 'unsupported_x402_version', payload }
	if (!payload.accepted) return { ok: false, error: 'missing_accepted_requirements', payload }

	let rt: Runtime
	try {
		rt = await getX402Runtime(env)
	} catch (e) {
		return {
			ok: false,
			error: `x402_runtime_unavailable: ${e instanceof Error ? e.message : String(e)}`,
			payload,
		}
	}

	const requirements = rt.server.findMatchingRequirements(accepts, payload)
	if (!requirements) return { ok: false, error: 'no_matching_requirements', payload }

	// SECURITY: client-signed requirements must match ours (payTo / asset / amount).
	const check = crossCheckSignedRequirements(payload.accepted, {
		payTo: requirements.payTo,
		asset: requirements.asset,
		maxAmountRequired: requirements.amount,
	})
	if (!check.ok) return { ok: false, error: check.error, payload }

	// SECURITY: a batch-settlement *refund* payload is not a payment. The SDK
	// marks it skipHandler and would execute an on-chain refund on settle; if we
	// treated that as "paid" a client could loop 1-wei refunds into free calls
	// (and burn facilitator gas). Refunds never ride a metered request.
	if (
		requirements.scheme === 'batch-settlement' &&
		isBatchSettlementRefundPayload(payload.payload)
	) {
		return { ok: false, error: 'refund_not_a_payment', payload }
	}

	const release = async () => {
		try {
			await rt.batchScheme?.clearPendingRequest(payload)
		} catch {
			/* best effort — lock TTL expires anyway */
		}
	}

	try {
		const v = await rt.server.verifyPayment(payload, requirements)
		if (!v.isValid) return { ok: false, error: v.invalidReason || 'payment_invalid', payload }
		if (v.skipHandler) {
			await release()
			return { ok: false, error: 'not_a_payment', payload }
		}
		if (opts.expectedPayer) {
			if (!v.payer || v.payer.toLowerCase() !== opts.expectedPayer.toLowerCase()) {
				await release()
				return { ok: false, error: 'payer_mismatch', payload }
			}
		}

		const s = await rt.server.settlePayment(payload, requirements)
		if (!s.success) return { ok: false, error: s.errorReason || 'settle_failed', payload }

		return {
			ok: true,
			scheme: requirements.scheme,
			network: String(s.network || requirements.network),
			payer: s.payer || v.payer,
			txHash: s.transaction || undefined,
			responseHeader: encodePaymentResponseHeader(s),
			settle: s,
		}
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e), payload }
	}
}

/** Snapshot for /.well-known/x402 and ops. */
export async function x402Status(env: X402ServiceEnv) {
	const networks = resolveX402Networks(
		env.AGENT_METERING_NETWORK,
		env.AGENT_METERING_USDC_ADDRESS,
		env.X402_EXTRA_NETWORKS,
	)
	let rt: Runtime | null = null
	if (env.X402_FACILITATOR_ENABLED === 'true') rt = await getX402Runtime(env).catch(() => null)
	return {
		x402Version: X402_VERSION,
		payTo: collectorOf(env),
		facilitator: env.X402_FACILITATOR_ENABLED === 'true',
		initialized: rt?.initialized ?? false,
		headers: {
			required: 'PAYMENT-REQUIRED',
			signature: 'PAYMENT-SIGNATURE',
			response: 'PAYMENT-RESPONSE',
		},
		schemes: {
			exact: networks.map((n) => ({ network: n.caip2, asset: n.asset, symbol: n.assetSymbol })),
			'batch-settlement': resolveBatchNetworks(env, networks).map((n) => ({
				network: n.caip2,
				asset: n.asset,
				symbol: n.assetSymbol,
				workerRunning: !!rt?.managers.length,
			})),
		},
	}
}
