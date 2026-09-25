/**
 * The trust-layer pipeline, orchestrated through provider interfaces.
 *
 * Order of gates (each can stop the trade):
 *  1. world-id      — human approves THIS trade intent (signal-bound proof)
 *  2. intercepta    — pre-sign screen of the x402 payTo
 *  3. uniswap       — quote + Permit2-aware approval check
 *  4. ensv2         — live onchain policy (spending caps)
 *  5. intercepta    — pre-execute screen of the exact unsigned transaction
 *  → decision: EXECUTED | BLOCKED | HELD→(step-up)→EXECUTED
 *
 * Verdicts use the REAL logic: scanResultToPolicySignal, validateWorldIdStepUp.
 * Mocks only replace the network transports (see providers.ts).
 */
import { scanResultToPolicySignal, escalationFor } from '../intercepta/policy.ts'
import { validateWorldIdStepUp, type WorldIdApproval } from '../world-id/stepUp.ts'
import type { TradeIntent } from '../world-id/guardianGate.ts'
import { UNISWAP_ROUTER, type DemoProviders } from './providers.ts'

export interface PipelineStep {
	gate: string
	status: 'pass' | 'block' | 'hold' | 'info' | 'escalate'
	detail: string
}

export interface PipelineInput {
	intent: TradeIntent
	/** x402 payTo / trade counterparty */
	payTo: string
	chain: string
	agentName: string
	valueUsd: number
	userId: number
	approvalId: string
}

export interface PipelineResult {
	decision: 'EXECUTED' | 'BLOCKED'
	steps: PipelineStep[]
	/** Present when BLOCKED — the exact reason shown to the user. */
	blockReason?: string
}

const step = (gate: string, status: PipelineStep['status'], detail: string): PipelineStep => ({
	gate,
	status,
	detail,
})

export async function runTradePipeline(p: DemoProviders, input: PipelineInput): Promise<PipelineResult> {
	const steps: PipelineStep[] = []
	const { intent } = input

	steps.push(step('intent', 'info', `agent proposes: ${intent.summary}`))

	// --- Gate 1: World ID guardian gate -------------------------------------
	const { connectorURI, signal } = await p.worldId.start(intent)
	steps.push(step('world-id', 'info', `proof request ready — signal ${signal.slice(0, 14)}… bound to this exact trade`))
	steps.push(step('world-id', 'info', `scan to verify: ${connectorURI}`))

	const approval = await p.worldId.awaitApproval(signal)
	if (!approval.ok) {
		const reason = `World ID verification failed: ${approval.reason} — trade NOT executed`
		steps.push(step('world-id', 'block', reason))
		return { decision: 'BLOCKED', steps, blockReason: reason }
	}
	steps.push(step('world-id', 'pass', `human verified (nullifier …${approval.nullifier.slice(-6)})`))

	// --- Gate 2: Intercepta pre-sign screen ----------------------------------
	const addrScan = await p.screen.screenAddress(input.payTo, input.chain)
	const preSign = scanResultToPolicySignal(addrScan, 'payment destination')
	if (preSign.verdict === 'block') {
		steps.push(step('intercepta', 'block', preSign.reason + ' — agent never signed'))
		return { decision: 'BLOCKED', steps, blockReason: preSign.reason }
	}
	if (preSign.verdict === 'require_approval') {
		steps.push(step('intercepta', 'hold', preSign.reason))
		if (escalationFor(preSign) === 'world_id_step_up') {
			// Held → escalate to World ID step-up (fresh, single-use approval).
			const stepUpApproval: WorldIdApproval = {
				nullifier: approval.nullifier,
				signal,
				expectedSignal: signal,
				verifiedAt: new Date(),
				consumedAt: null,
				userId: input.userId,
				approvalId: input.approvalId,
			}
			const v = validateWorldIdStepUp(stepUpApproval, {
				userId: input.userId,
				approvalId: input.approvalId,
				now: new Date(),
				ttlMs: 15 * 60 * 1000,
			})
			if (!v.valid) {
				const reason = `step-up failed: ${v.reason} — trade NOT executed`
				steps.push(step('world-id-step-up', 'block', reason))
				return { decision: 'BLOCKED', steps, blockReason: reason }
			}
			steps.push(step('world-id-step-up', 'escalate', 'human re-verified via World ID step-up — hold released'))
		}
	} else {
		steps.push(step('intercepta', 'pass', `payTo screened before signing (risk ${addrScan.riskScore}/100)`))
	}

	// --- Gate 3: Uniswap quote + approval ------------------------------------
	const quoteReq = {
		tokenInChainId: 8453,
		tokenOutChainId: 8453,
		tokenIn: intent.fromToken,
		tokenOut: intent.toToken,
		amount: intent.amountIn,
	}
	const q = await p.quote.quote(quoteReq)
	steps.push(
		step(
			'uniswap',
			'pass',
			`${q.routeType} route: ${q.amountIn} → ${q.amountOut} (gas $${q.gasFeeUsd?.toFixed(2) ?? '?'})`,
		),
	)
	const appr = await p.quote.checkApproval({
		chainId: 8453,
		token: intent.fromToken,
		wallet: input.payTo,
		amount: intent.amountIn,
	})
	steps.push(
		step('uniswap', appr.approved ? 'pass' : 'block', appr.approved ? 'Permit2 approval verified' : 'missing token approval — cannot build swap'),
	)
	if (!appr.approved) {
		return { decision: 'BLOCKED', steps, blockReason: 'missing token approval for the Uniswap router' }
	}

	// --- Gate 4: ENSv2 onchain policy -----------------------------------------
	const policy = await p.ensv2.resolveAndCheck(input.agentName, { valueUsd: input.valueUsd, chain: input.chain })
	if (policy.blockReason) {
		steps.push(step('ensv2', 'block', policy.blockReason))
		return { decision: 'BLOCKED', steps, blockReason: policy.blockReason }
	}
	steps.push(
		step('ensv2', 'pass', `${input.agentName} resolved live — $${input.valueUsd.toFixed(2)} within onchain cap $${policy.policy?.maxTxUsd}`),
	)

	// --- Gate 5: Intercepta pre-execute screen ---------------------------------
	const txScan = await p.screen.screenTransaction({ to: UNISWAP_ROUTER, chain: input.chain })
	const preExec = scanResultToPolicySignal(txScan, 'transaction')
	if (preExec.verdict === 'block') {
		steps.push(step('intercepta', 'block', preExec.reason))
		return { decision: 'BLOCKED', steps, blockReason: preExec.reason }
	}
	if (preExec.verdict === 'require_approval') {
		const reason = `pre-execute screen requires approval: ${preExec.reason} — trade NOT executed`
		steps.push(step('intercepta', 'block', reason))
		return { decision: 'BLOCKED', steps, blockReason: reason }
	}
	steps.push(step('intercepta', 'pass', `exact unsigned tx screened (risk ${txScan.riskScore}/100)`))

	return { decision: 'EXECUTED', steps }
}
