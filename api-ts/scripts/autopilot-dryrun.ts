#!/usr/bin/env bun
import { seal, verifySeal } from '../src/lib/seal'
/**
 * Offline dry run of the autopilot's decision path: read → think → gate → seal.
 *
 * Touches no database and executes nothing. It screens the live market, forms
 * real theses, runs the real gate and seals each decision, then verifies the
 * commitment — which is the fastest way to see what the agent would do, and
 * what it would refuse, before pointing it at a database or a wallet.
 *
 *   bun run scripts/autopilot-dryrun.ts [--chains base,solana] [--equity 1000]
 *   bun run scripts/autopilot-dryrun.ts --pairs snapshot.json
 *
 * `--pairs` replays a saved DexScreener pair array instead of hitting the
 * network, which makes a run reproducible and lets the decision path be
 * exercised from an environment with no outbound access to the screener.
 */
import { evaluateGates } from '../src/services/autopilot/gates'
import {
	dedupeByToken,
	fetchTokenSecurity,
	pairToCandidate,
	screenCandidates,
} from '../src/services/autopilot/market'
import { RulesThesisEngine } from '../src/services/autopilot/thesis'
import { type Candidate, DEFAULT_RULES, type PortfolioState } from '../src/services/autopilot/types'

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`)
	return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}

const chains = arg('chains', 'base,solana')
	.split(',')
	.map((c) => c.trim())
	.filter(Boolean)
const equityUsd = Number(arg('equity', '1000'))

const rules = { ...DEFAULT_RULES, allowedChains: chains }
const engine = new RulesThesisEngine()

const portfolio: PortfolioState = {
	equityUsd,
	deployedUsd: 0,
	openPositions: [],
	spentTodayUsd: 0,
	realizedPnlTodayUsd: 0,
	lastTradeAtByToken: {},
}

console.log(`\nAutopilot dry run — chains: ${chains.join(', ')}, equity: $${equityUsd}\n`)

const pairsFile = arg('pairs', '')
let candidates: Candidate[]
if (pairsFile) {
	const raw = JSON.parse(await Bun.file(pairsFile).text()) as unknown[]
	candidates = dedupeByToken(
		raw.map((p) => pairToCandidate(p as never)).filter((c): c is Candidate => c !== null),
	)
		.filter((c) => chains.includes(c.chain))
		.filter((c) => c.liquidityUsd >= rules.minLiquidityUsd)
		.sort((a, b) => b.volume24hUsd - a.volume24hUsd)
		.slice(0, 15)
	console.log(`read:  ${candidates.length} candidates from ${pairsFile}\n`)
} else {
	candidates = await screenCandidates({
		chains,
		minLiquidityUsd: rules.minLiquidityUsd,
		limit: 15,
	})
	console.log(`read:  ${candidates.length} candidates cleared the screen\n`)
}

let considered = 0
let wouldTrade = 0

for (const candidate of candidates) {
	const thesis = await engine.formEntry(candidate, {
		availableUsd: equityUsd,
		maxPositionUsd: rules.maxPositionUsd,
		openPositions: [],
	})
	if (!thesis) continue
	considered++

	const security = await fetchTokenSecurity(
		process.env.INTERNAL_API_URL ?? '',
		process.env.INTERNAL_API_KEY ?? '',
		candidate.chain,
		candidate.tokenAddress,
	)
	const enriched = security ? { ...candidate, security } : candidate

	const verdict = evaluateGates(thesis, enriched, portfolio, rules)
	const s = seal(thesis)
	const sealOk = verifySeal(thesis, s.nonce, s.commitment)

	console.log(
		`${verdict.passed ? '✓ WOULD BUY' : '✗ REFUSED  '} ${thesis.symbol} (${thesis.chain})`,
	)
	console.log(`   ${thesis.headline}`)
	console.log(`   size $${thesis.sizeUsd.toFixed(2)}  confidence ${thesis.confidence}`)
	console.log(`   seal ${s.commitment.slice(0, 16)}…  verifies: ${sealOk}`)
	if (!verdict.passed) {
		for (const r of verdict.results.filter((x) => !x.passed)) {
			console.log(`   └─ ${r.rule}: ${r.detail}`)
		}
	}
	console.log()
	if (verdict.passed) wouldTrade++
}

console.log(
	`think: ${considered} theses formed\ngate:  ${wouldTrade} would execute, ${considered - wouldTrade} refused\n`,
)
if (considered > 0 && wouldTrade === 0) {
	console.log(
		'Nothing cleared the gate. With INTERNAL_API_KEY unset this is expected — the\n' +
			'security scan is unavailable, and an unavailable scan refuses the trade.\n',
	)
}
