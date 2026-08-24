/**
 * Stage 3 — the gate. Pure, synchronous, dependency-free risk rules.
 *
 * Two properties matter here:
 *  1. Every rule runs, even after one fails, so the journal records the full
 *     verdict rather than "died at rule #1".
 *  2. Exits are never blocked by exposure/liquidity rules. A risk system that
 *     can stop you selling is a bug, not a safeguard.
 */
import type {
	AutopilotRules,
	Candidate,
	GateResult,
	GateVerdict,
	PortfolioState,
	Thesis,
} from './types'

function check(
	rule: string,
	passed: boolean,
	detail: string,
	observed?: number | string | boolean,
	limit?: number | string | boolean,
): GateResult {
	const r: GateResult = { rule, passed, detail }
	if (observed !== undefined) r.observed = observed
	if (limit !== undefined) r.limit = limit
	return r
}

const norm = (addr: string) => addr.trim().toLowerCase()

/** Rules that apply to any decision, entry or exit. */
function universalGates(thesis: Thesis, rules: AutopilotRules): GateResult[] {
	const token = norm(thesis.tokenAddress)
	const denied = rules.deniedTokens.map(norm).includes(token)
	const chainAllowed = rules.allowedChains
		.map((c) => c.toLowerCase())
		.includes(thesis.chain.toLowerCase())

	return [
		check(
			'chain_allowed',
			chainAllowed,
			chainAllowed ? `${thesis.chain} is allowed` : `${thesis.chain} is not in the allowlist`,
			thesis.chain,
			rules.allowedChains.join(','),
		),
		check(
			'token_not_denied',
			!denied,
			denied ? `${thesis.symbol} is on the denylist` : `${thesis.symbol} is not denied`,
			thesis.tokenAddress,
		),
	]
}

function entryGates(
	thesis: Thesis,
	candidate: Candidate | undefined,
	portfolio: PortfolioState,
	rules: AutopilotRules,
	nowMs: number,
): GateResult[] {
	const results: GateResult[] = []
	const token = norm(thesis.tokenAddress)

	// --- sizing & exposure ---
	results.push(
		check(
			'max_position_size',
			thesis.sizeUsd <= rules.maxPositionUsd,
			`size $${thesis.sizeUsd.toFixed(2)} vs cap $${rules.maxPositionUsd}`,
			thesis.sizeUsd,
			rules.maxPositionUsd,
		),
	)
	results.push(
		check(
			'positive_size',
			thesis.sizeUsd > 0,
			thesis.sizeUsd > 0 ? 'size is positive' : 'buy with non-positive size',
			thesis.sizeUsd,
		),
	)

	// Defence in depth: the screener already drops quote assets, but a regression
	// there must not be able to spend the book's own currency on itself.
	const isBaseToken = portfolio.baseToken !== undefined && norm(portfolio.baseToken) === token
	results.push(
		check(
			'not_base_token',
			!isBaseToken,
			isBaseToken
				? `${thesis.symbol} is the agent's own quote asset`
				: `${thesis.symbol} is not the quote asset`,
		),
	)

	const alreadyOpen = portfolio.openPositions.some((p) => norm(p.tokenAddress) === token)
	results.push(
		check(
			'no_duplicate_position',
			!alreadyOpen,
			alreadyOpen ? `already holding ${thesis.symbol}` : `no open position in ${thesis.symbol}`,
		),
	)

	const slotsFree = portfolio.openPositions.length < rules.maxOpenPositions
	results.push(
		check(
			'max_open_positions',
			slotsFree,
			`${portfolio.openPositions.length} open vs max ${rules.maxOpenPositions}`,
			portfolio.openPositions.length,
			rules.maxOpenPositions,
		),
	)

	const projectedExposurePct =
		portfolio.equityUsd > 0
			? ((portfolio.deployedUsd + thesis.sizeUsd) / portfolio.equityUsd) * 100
			: 100
	results.push(
		check(
			'max_portfolio_exposure',
			projectedExposurePct <= rules.maxPortfolioExposurePct,
			`projected exposure ${projectedExposurePct.toFixed(1)}% vs cap ${rules.maxPortfolioExposurePct}%`,
			Number(projectedExposurePct.toFixed(2)),
			rules.maxPortfolioExposurePct,
		),
	)

	const affordable = thesis.sizeUsd <= portfolio.equityUsd - portfolio.deployedUsd
	results.push(
		check(
			'sufficient_dry_powder',
			affordable,
			`free capital $${(portfolio.equityUsd - portfolio.deployedUsd).toFixed(2)} vs size $${thesis.sizeUsd.toFixed(2)}`,
		),
	)

	// --- velocity & circuit breakers ---
	const withinDailyCap = portfolio.spentTodayUsd + thesis.sizeUsd <= rules.dailySpendCapUsd
	results.push(
		check(
			'daily_spend_cap',
			withinDailyCap,
			`spent today $${portfolio.spentTodayUsd.toFixed(2)} + $${thesis.sizeUsd.toFixed(2)} vs cap $${rules.dailySpendCapUsd}`,
			Number((portfolio.spentTodayUsd + thesis.sizeUsd).toFixed(2)),
			rules.dailySpendCapUsd,
		),
	)

	// Realized AND mark-to-market. A halt that counts only closed trades cannot
	// fire while the damage is still on the book, which is exactly when it is
	// most needed — an agent sitting on large unrealized losses has realized
	// nothing and would otherwise keep opening positions.
	const totalPnlUsd = portfolio.realizedPnlTodayUsd + portfolio.unrealizedPnlUsd
	const lossHalt = -totalPnlUsd >= rules.dailyLossHaltUsd
	results.push(
		check(
			'daily_loss_halt',
			!lossHalt,
			lossHalt
				? `loss $${(-totalPnlUsd).toFixed(2)} (realized $${portfolio.realizedPnlTodayUsd.toFixed(2)} + unrealized $${portfolio.unrealizedPnlUsd.toFixed(2)}) hit the halt at $${rules.dailyLossHaltUsd}`
				: `P&L $${totalPnlUsd.toFixed(2)} (realized + unrealized) is above the halt`,
			Number(totalPnlUsd.toFixed(2)),
			-rules.dailyLossHaltUsd,
		),
	)

	const lastTradeAt = portfolio.lastTradeAtByToken[token]
	const cooldownMs = rules.tokenCooldownMinutes * 60_000
	const cooledDown = lastTradeAt === undefined || nowMs - lastTradeAt >= cooldownMs
	results.push(
		check(
			'token_cooldown',
			cooledDown,
			cooledDown
				? `no recent trade in ${thesis.symbol}`
				: `last traded ${Math.round((nowMs - (lastTradeAt ?? 0)) / 60_000)}m ago, cooldown is ${rules.tokenCooldownMinutes}m`,
		),
	)

	// --- confidence & exit plan ---
	results.push(
		check(
			'min_confidence',
			thesis.confidence >= rules.minConfidence,
			`confidence ${thesis.confidence.toFixed(2)} vs floor ${rules.minConfidence}`,
			thesis.confidence,
			rules.minConfidence,
		),
	)

	if (rules.requireExitPlan) {
		const hasExit =
			typeof thesis.exit?.stopLossPct === 'number' &&
			thesis.exit.stopLossPct > 0 &&
			typeof thesis.exit?.invalidation === 'string' &&
			thesis.exit.invalidation.trim().length > 0
		results.push(
			check(
				'exit_plan_committed',
				hasExit,
				hasExit ? 'stop-loss and invalidation are set' : 'entry has no stop-loss or invalidation',
			),
		)
	}

	// --- market structure (needs the candidate the thesis was formed on) ---
	if (!candidate) {
		results.push(check('market_data_present', false, 'no market snapshot backing this thesis'))
		return results
	}

	results.push(
		check(
			'min_liquidity',
			candidate.liquidityUsd >= rules.minLiquidityUsd,
			`liquidity $${Math.round(candidate.liquidityUsd)} vs floor $${rules.minLiquidityUsd}`,
			Math.round(candidate.liquidityUsd),
			rules.minLiquidityUsd,
		),
	)

	const poolSharePct =
		candidate.liquidityUsd > 0 ? (thesis.sizeUsd / candidate.liquidityUsd) * 100 : 100
	results.push(
		check(
			'max_pool_share',
			poolSharePct <= rules.maxPoolSharePct,
			`position is ${poolSharePct.toFixed(3)}% of the pool vs cap ${rules.maxPoolSharePct}%`,
			Number(poolSharePct.toFixed(4)),
			rules.maxPoolSharePct,
		),
	)

	const age = candidate.ageMinutes
	const oldEnough = age === undefined ? false : age >= rules.minTokenAgeMinutes
	results.push(
		check(
			'min_token_age',
			oldEnough,
			age === undefined
				? 'pool age unknown — refusing to guess'
				: `age ${Math.round(age)}m vs floor ${rules.minTokenAgeMinutes}m`,
			age ?? 'unknown',
			rules.minTokenAgeMinutes,
		),
	)

	// --- token security ---
	const sec = candidate.security
	if (!sec) {
		results.push(check('security_scan_present', false, 'no token-security scan available'))
		return results
	}

	results.push(
		check(
			'not_honeypot',
			sec.isHoneypot !== true,
			sec.isHoneypot === true ? 'token is flagged as a honeypot' : 'no honeypot flag',
		),
	)
	results.push(
		check(
			'max_buy_tax',
			(sec.buyTaxBps ?? 0) <= rules.maxBuyTaxBps,
			`buy tax ${sec.buyTaxBps ?? 0}bps vs cap ${rules.maxBuyTaxBps}bps`,
			sec.buyTaxBps ?? 0,
			rules.maxBuyTaxBps,
		),
	)
	results.push(
		check(
			'max_sell_tax',
			(sec.sellTaxBps ?? 0) <= rules.maxSellTaxBps,
			`sell tax ${sec.sellTaxBps ?? 0}bps vs cap ${rules.maxSellTaxBps}bps`,
			sec.sellTaxBps ?? 0,
			rules.maxSellTaxBps,
		),
	)

	const topPct = sec.topHolderPct
	const concentrationOk = topPct === undefined ? false : topPct <= rules.maxTopHolderPct
	results.push(
		check(
			'holder_concentration',
			concentrationOk,
			topPct === undefined
				? 'holder distribution unknown'
				: `top holders ${topPct.toFixed(1)}% vs cap ${rules.maxTopHolderPct}%`,
			topPct ?? 'unknown',
			rules.maxTopHolderPct,
		),
	)

	if (rules.requireLpLocked) {
		results.push(
			check(
				'lp_locked',
				sec.lpLocked === true,
				sec.lpLocked === true ? 'LP is locked' : 'LP is not verifiably locked',
			),
		)
	}

	return results
}

/**
 * Exits run a deliberately thin gate: we only refuse to sell something we do
 * not hold. Nothing about exposure, liquidity or daily caps may stand between
 * the agent and the door.
 */
function exitGates(thesis: Thesis, portfolio: PortfolioState): GateResult[] {
	const token = norm(thesis.tokenAddress)
	const held = portfolio.openPositions.find((p) => norm(p.tokenAddress) === token)
	return [
		check(
			'position_exists',
			Boolean(held),
			held ? `holding ${thesis.symbol}` : `no open position in ${thesis.symbol} to sell`,
		),
	]
}

export function evaluateGates(
	thesis: Thesis,
	candidate: Candidate | undefined,
	portfolio: PortfolioState,
	rules: AutopilotRules,
	nowMs: number = Date.now(),
): GateVerdict {
	const results = [...universalGates(thesis, rules)]

	if (thesis.action === 'buy') {
		results.push(...entryGates(thesis, candidate, portfolio, rules, nowMs))
	} else if (thesis.action === 'sell') {
		results.push(...exitGates(thesis, portfolio))
	}
	// `hold` runs the universal gates only — nothing moves, nothing to guard.

	const failed = results.filter((r) => !r.passed)
	const verdict: GateVerdict = { passed: failed.length === 0, results }
	if (failed.length > 0 && failed[0])
		verdict.rejectionReason = `${failed[0].rule}: ${failed[0].detail}`
	return verdict
}

/**
 * Exit triggers evaluated on every cycle against live prices — this is what
 * turns a committed exit plan into an actual sell decision.
 */
export function shouldExit(
	position: {
		avgEntryPriceUsd: number
		takeProfitPct?: number | undefined
		stopLossPct?: number | undefined
		openedAt: number
	},
	currentPriceUsd: number,
	maxHoldMinutes: number | undefined,
	nowMs: number = Date.now(),
): { exit: boolean; reason?: string } {
	if (!(position.avgEntryPriceUsd > 0) || !(currentPriceUsd > 0)) return { exit: false }
	const pnlPct = ((currentPriceUsd - position.avgEntryPriceUsd) / position.avgEntryPriceUsd) * 100

	if (position.stopLossPct !== undefined && pnlPct <= -Math.abs(position.stopLossPct)) {
		return {
			exit: true,
			reason: `stop-loss hit: ${pnlPct.toFixed(1)}% <= -${Math.abs(position.stopLossPct)}%`,
		}
	}
	if (position.takeProfitPct !== undefined && pnlPct >= position.takeProfitPct) {
		return {
			exit: true,
			reason: `take-profit hit: ${pnlPct.toFixed(1)}% >= ${position.takeProfitPct}%`,
		}
	}
	if (maxHoldMinutes !== undefined && nowMs - position.openedAt >= maxHoldMinutes * 60_000) {
		return {
			exit: true,
			reason: `time stop: held ${Math.round((nowMs - position.openedAt) / 60_000)}m`,
		}
	}
	return { exit: false }
}

/**
 * Slippage allowance for closing a position, widened by each consecutive
 * failure up to the ceiling.
 *
 * Deliberately asymmetric with entries. Refusing to buy costs nothing, so an
 * entry never escalates. Refusing to sell costs whatever the position does
 * next, so an exit is allowed to pay to complete — the alternative is a
 * stop-loss that reliably fails in precisely the conditions it exists for.
 */
export function exitSlippageBps(attempts: number, rules: AutopilotRules): number {
	const n = Math.max(0, Math.floor(attempts))
	return Math.min(rules.maxSlippageBps * 2 ** n, rules.exitSlippageCeilingBps)
}
