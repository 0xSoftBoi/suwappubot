/**
 * The public proof surface.
 *
 * Research finding this exists to answer: across ~$19B of 2025–26 token buyback
 * programs, only 2 of 11 tracked tokens actually shrank supply. The category's
 * problem is not execution — anyone can run a swap — it is that nobody can
 * check. Hyperliquid's Assistance Fund is believed precisely because
 * assistancefund.top lets a stranger verify every purchase, with "no off-chain
 * accounting, no discretionary timing, no 'we'll announce the burn next
 * quarter' framing".
 *
 * Hyperliquid built that bespoke. A meme-coin team with a $40k treasury cannot,
 * so their only option today is a screenshot in the group chat — which is
 * exactly the announcement-disconnected-from-mechanics pattern the whole
 * category is being marked down for. This module gives every tenant the same
 * artifact, generated.
 *
 * ## The rules that make it proof rather than marketing
 *
 * 1. **Refusals are published too.** A page that only shows successes is a
 *    highlight reel. Skipped and failed runs appear with their reasons, because
 *    "this automation has been failing for a week" is the single most useful
 *    thing a holder can learn here and the thing a team is least likely to say.
 * 2. **No cumulative vanity metric without context.** "Total burned: $40,000"
 *    is the flagged failure mode: it implies supply impact it does not
 *    establish. Every burn total is reported alongside what it is and is not
 *    evidence of.
 * 3. **Simulated runs are labelled, never counted as burns.** They are shown —
 *    hiding them would misrepresent activity — but in their own bucket.
 * 4. **Every claim links to a transaction.** A number a reader cannot verify on
 *    a block explorer is our word for it, and our word is not the point.
 * 5. **Funding source is stated, including when it is unknown.** Revenue-funded
 *    is durable; treasury-funded runs out. We will not guess on a team's behalf
 *    and we will not let silence read as the flattering answer.
 */

export interface ProofRun {
	status: 'simulated' | 'succeeded' | 'failed' | 'skipped'
	reason: string | null
	spendUsd: number
	tokenAmount: string | null
	txHash: string | null
	startedAt: Date
}

export interface ProofTotals {
	/** Live runs that actually broadcast. The only ones that moved supply. */
	executedRuns: number
	executedSpendUsd: number
	/** Dry runs. Shown separately; never added to the executed figures. */
	simulatedRuns: number
	/** Refusals and errors — published on purpose. */
	skippedRuns: number
	failedRuns: number
	/** Of the executed runs, how many carry a verifiable tx hash. A gap here is
	 *  a coverage lapse and is reported as one rather than quietly ignored. */
	verifiableRuns: number
	firstRunAt: Date | null
	lastRunAt: Date | null
}

export function summarise(runs: ProofRun[]): ProofTotals {
	const t: ProofTotals = {
		executedRuns: 0,
		executedSpendUsd: 0,
		simulatedRuns: 0,
		skippedRuns: 0,
		failedRuns: 0,
		verifiableRuns: 0,
		firstRunAt: null,
		lastRunAt: null,
	}
	for (const r of runs) {
		if (r.status === 'succeeded') {
			t.executedRuns += 1
			t.executedSpendUsd += r.spendUsd
			if (r.txHash) t.verifiableRuns += 1
		} else if (r.status === 'simulated') {
			t.simulatedRuns += 1
		} else if (r.status === 'skipped') {
			t.skippedRuns += 1
		} else {
			t.failedRuns += 1
		}
		if (!t.firstRunAt || r.startedAt < t.firstRunAt) t.firstRunAt = r.startedAt
		if (!t.lastRunAt || r.startedAt > t.lastRunAt) t.lastRunAt = r.startedAt
	}
	return t
}

export type ProofCaveat =
	| 'no_executed_runs'
	| 'unverifiable_runs'
	| 'funding_undisclosed'
	| 'treasury_funded'
	| 'no_supply_context'
	| 'recently_failing'
	| 'stalled'

export interface Caveat {
	code: ProofCaveat
	/** Written for a holder, not an engineer. */
	text: string
}

/**
 * What this page does NOT establish.
 *
 * Published at the top of the proof page rather than in a footnote. The whole
 * reason the category has a credibility problem is that the caveats were left
 * for the reader to work out, and most readers did not. Stating them is what
 * makes the rest believable.
 */
export function caveatsFor(input: {
	totals: ProofTotals
	fundingSource: 'revenue' | 'treasury' | 'undisclosed'
	kind: string
	recentFailures: number
	now?: Date
}): Caveat[] {
	const out: Caveat[] = []
	const { totals, fundingSource } = input
	const now = input.now ?? new Date()

	if (totals.executedRuns === 0) {
		out.push({
			code: 'no_executed_runs',
			text:
				'Nothing has been executed with real funds yet. Any figures below are from ' +
				'dry runs, which move nothing.',
		})
	}

	if (totals.executedRuns > 0 && totals.verifiableRuns < totals.executedRuns) {
		const missing = totals.executedRuns - totals.verifiableRuns
		out.push({
			code: 'unverifiable_runs',
			text:
				`${missing} of ${totals.executedRuns} executed runs have no transaction hash ` +
				'recorded, so they cannot be independently checked. Treat those as unproven.',
		})
	}

	if (fundingSource === 'undisclosed') {
		out.push({
			code: 'funding_undisclosed',
			text:
				'This team has not stated where the money comes from. Programs paid for out ' +
				'of recurring revenue can continue indefinitely; ones paid out of a fixed ' +
				'treasury stop when it runs out.',
		})
	} else if (fundingSource === 'treasury') {
		out.push({
			code: 'treasury_funded',
			text:
				'Funded from a treasury rather than recurring revenue, so it continues only ' +
				'while the treasury lasts.',
		})
	}

	if (input.kind === 'buy_and_burn' && totals.executedRuns > 0) {
		out.push({
			code: 'no_supply_context',
			text:
				'Tokens bought here were sent to a burn address. That reduces supply by the ' +
				'amount burned — it does not tell you whether total supply is falling, ' +
				'because scheduled unlocks and new issuance are not counted here. Check the ' +
				"token's emission schedule before drawing a conclusion.",
		})
	}

	if (input.recentFailures >= 2) {
		out.push({
			code: 'recently_failing',
			text: `The last ${input.recentFailures} runs did not complete. Something is wrong.`,
		})
	}

	if (totals.lastRunAt) {
		const daysSince = (now.getTime() - totals.lastRunAt.getTime()) / 86_400_000
		if (daysSince > 7) {
			out.push({
				code: 'stalled',
				text: `Nothing has run for ${Math.floor(daysSince)} days.`,
			})
		}
	}

	return out
}

/** One-line honest headline. Never a supply claim. */
export function headline(totals: ProofTotals, kind: string, symbol: string): string {
	if (totals.executedRuns === 0) {
		return `No ${kind === 'buy_and_burn' ? 'burns' : 'buybacks'} executed yet`
	}
	const verb = kind === 'buy_and_burn' ? 'sent to a burn address' : 'bought back'
	return `$${totals.executedSpendUsd.toLocaleString()} of ${symbol} ${verb} across ${totals.executedRuns} ${
		totals.executedRuns === 1 ? 'run' : 'runs'
	}`
}
