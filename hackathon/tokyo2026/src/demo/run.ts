#!/usr/bin/env bun
/**
 * Executable demo: `bun run src/demo/run.ts`
 *
 * Runs the trust-layer pipeline through five scenarios using mock providers
 * (no keys needed). Each scenario asserts the expected decision — the demo
 * is self-checking and exits non-zero if any scenario misbehaves.
 *
 * Scenarios:
 *  1. happy-path        all gates pass → EXECUTED
 *  2. blocked-payee     Intercepta flags payTo → BLOCKED before signing
 *  3. over-cap          ENSv2 onchain cap exceeded → BLOCKED
 *  4. denied-world-id   human declines World ID → BLOCKED, nothing executes
 *  5. held-escalation   suspicious payTo → require_approval → World ID
 *                       step-up → EXECUTED
 */
import { runTradePipeline, type PipelineInput } from './pipeline.ts'
import { buildProviders } from './live.ts'
import {
	mockProviders,
	ADDR_CLEAN,
	ADDR_FLAGGED,
	ADDR_SUSPICIOUS,
	type MockHumanBehavior,
} from './providers.ts'
import type { TradeIntent } from '../world-id/guardianGate.ts'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const SYMBOL = { pass: `${GREEN}✓${RESET}`, block: `${RED}✗${RESET}`, hold: `${YELLOW}◷${RESET}`, info: `${DIM}→${RESET}`, escalate: `${YELLOW}⇧${RESET}` } as const

function baseIntent(overrides: Partial<TradeIntent> = {}): TradeIntent {
	return {
		agentId: 'demo-agent',
		chain: 'base',
		fromToken: '0x4200000000000000000000000000000000000006', // WETH on Base
		toToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
		amountIn: '1500000000000000000',
		summary: 'Swap 1.5 ETH → USDC on Base',
		nonce: `demo-${Date.now()}`,
		...overrides,
	}
}

function baseInput(overrides: Partial<PipelineInput> = {}): PipelineInput {
	return {
		intent: baseIntent(),
		payTo: ADDR_CLEAN,
		chain: 'base',
		agentName: 'agent.demo.suwappu.eth',
		valueUsd: 450, // under the $500 mock onchain cap
		userId: 7,
		approvalId: 'demo-approval-1',
		...overrides,
	}
}

interface Scenario {
	name: string
	human: MockHumanBehavior
	input: PipelineInput
	expect: 'EXECUTED' | 'BLOCKED'
	expectGate?: string // a gate that must appear with a block in the transcript
}

const SCENARIOS: Scenario[] = [
	{
		name: 'happy-path — all gates pass',
		human: 'approves',
		input: baseInput(),
		expect: 'EXECUTED',
	},
	{
		name: 'blocked-payee — Intercepta flags the destination',
		human: 'approves',
		input: baseInput({ payTo: ADDR_FLAGGED }),
		expect: 'BLOCKED',
		expectGate: 'intercepta',
	},
	{
		name: 'over-cap — ENSv2 onchain cap exceeded',
		human: 'approves',
		input: baseInput({ valueUsd: 5000 }),
		expect: 'BLOCKED',
		expectGate: 'ensv2',
	},
	{
		name: 'denied-world-id — human declines, nothing executes',
		human: 'denies',
		input: baseInput(),
		expect: 'BLOCKED',
		expectGate: 'world-id',
	},
	{
		name: 'held-escalation — suspicious payTo → World ID step-up → executed',
		human: 'approves',
		input: baseInput({ payTo: ADDR_SUSPICIOUS }),
		expect: 'EXECUTED',
		expectGate: 'world-id-step-up',
	},
]

let failures = 0

const liveMode = process.argv.includes('--live')

if (liveMode) {
	// Strict live mode: every provider must be live (keys in .env). Runs the
	// happy path once — the human scans the REAL World ID QR.
	console.log(`${DIM}LIVE mode — all providers must be configured${RESET}`)
	const { providers, live } = buildProviders({ strictLive: true })
	console.log(`${DIM}live: ${Object.entries(live).filter(([, v]) => v).map(([k]) => k).join(', ')}${RESET}`)
	const input = baseInput()
	console.log(`\n${DIM}━━━ live: happy-path ━━━${RESET}`)
	console.log(`${DIM}intent:${RESET} ${input.intent.summary}`)
	const result = await runTradePipeline(providers, input)
	for (const st of result.steps) {
		console.log(`  ${SYMBOL[st.status]} ${DIM}[${st.gate}]${RESET} ${st.detail}`)
	}
	const decisionColor = result.decision === 'EXECUTED' ? GREEN : RED
	console.log(`  ${decisionColor}decision: ${result.decision}${RESET}`)
	if (result.decision !== 'EXECUTED') {
		console.log(`${RED}live happy-path did not execute${RESET}`)
		process.exit(1)
	}
	console.log(`${GREEN}live happy-path executed${RESET}`)
	process.exit(0)
}

for (const s of SCENARIOS) {
	console.log(`\n${DIM}━━━ scenario: ${s.name} ━━━${RESET}`)
	const result = await runTradePipeline(mockProviders(s.human), s.input)
	for (const st of result.steps) {
		console.log(`  ${SYMBOL[st.status]} ${DIM}[${st.gate}]${RESET} ${st.detail}`)
	}
	const decisionColor = result.decision === 'EXECUTED' ? GREEN : RED
	console.log(`  ${decisionColor}decision: ${result.decision}${RESET}`)

	let ok = result.decision === s.expect
	if (ok && s.expectGate) {
		ok = result.steps.some((st) => st.gate === s.expectGate && (st.status === 'block' || st.status === 'escalate'))
	}
	if (!ok) {
		failures++
		console.log(`  ${RED}ASSERTION FAILED: expected ${s.expect}${s.expectGate ? ` with gate ${s.expectGate}` : ''}${RESET}`)
	}
}

console.log('')
if (failures > 0) {
	console.log(`${RED}${failures} scenario(s) failed${RESET}`)
	process.exit(1)
}
console.log(`${GREEN}all ${SCENARIOS.length} scenarios behaved as expected${RESET}`)
