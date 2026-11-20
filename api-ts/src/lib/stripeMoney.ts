/**
 * Turn Stripe balance transactions into the card-money figures the admin
 * Growth report shows. Pure (no Stripe client) so the arithmetic is testable
 * and the report cannot disagree with itself.
 *
 * Source of truth is Stripe's BALANCE, not checkout sessions or invoices: a
 * balance transaction exists only once money has actually moved, and refunds
 * and disputes appear as their own negative entries.
 */

/** The fields of a Stripe BalanceTransaction this module needs. */
export interface BalanceTxn {
	/** Minor units (cents), signed: positive for money in, negative for money out. */
	amount: number
	/** Stripe's processing fee for this transaction, minor units, positive. */
	fee: number
	currency: string
	/** Unix seconds. */
	created: number
	/** Stripe's accounting bucket: 'charge' | 'refund' | 'dispute' | 'dispute_reversal' | 'payout' | ... */
	reporting_category: string
}

export interface StripePeriod {
	/** Card payments received, before refunds and fees. */
	receivedUsd: number
	refundedUsd: number
	/** Net of chargebacks lost and won. */
	disputedUsd: number
	/** Stripe's processing fees on the payments received. */
	feesUsd: number
	/** received - refunded - disputed - fees: what the period added to the Stripe balance. */
	netUsd: number
	payments: number
}

export interface StripeMoneySummary {
	window: StripePeriod
	previous: StripePeriod
	/** UTC day (YYYY-MM-DD) -> received minus refunds and disputes, for the window only. */
	byDay: Record<string, number>
	/** Transactions skipped because they are not in USD. */
	nonUsdSkipped: number
	/** True when the transaction cap was hit, so totals may be understated. */
	truncated: boolean
}

const emptyPeriod = (): StripePeriod => ({
	receivedUsd: 0,
	refundedUsd: 0,
	disputedUsd: 0,
	feesUsd: 0,
	netUsd: 0,
	payments: 0,
})

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * @param windowStartMs  start of the reporting window (inclusive)
 * @param prevStartMs    start of the comparison window (inclusive); it ends at windowStartMs
 */
export function summarizeBalanceTransactions(
	txns: readonly BalanceTxn[],
	windowStartMs: number,
	prevStartMs: number,
	truncated = false,
): StripeMoneySummary {
	const window = emptyPeriod()
	const previous = emptyPeriod()
	const byDay: Record<string, number> = {}
	let nonUsdSkipped = 0

	for (const t of txns) {
		const ms = t.created * 1000
		if (ms < prevStartMs) continue
		const category = t.reporting_category
		// Payouts, transfers and Stripe's own adjustments move money between the
		// Stripe balance and the bank: they are not income or refunds.
		if (
			category !== 'charge' &&
			category !== 'refund' &&
			category !== 'dispute' &&
			category !== 'dispute_reversal'
		)
			continue
		if (t.currency.toLowerCase() !== 'usd') {
			nonUsdSkipped++
			continue
		}

		const period = ms >= windowStartMs ? window : previous
		const usd = t.amount / 100
		let dayDelta = 0
		if (category === 'charge') {
			period.receivedUsd += usd
			period.feesUsd += t.fee / 100
			period.payments++
			dayDelta = usd
		} else if (category === 'refund') {
			// Refund amounts are negative; report them as a positive "refunded" figure.
			period.refundedUsd += -usd
			dayDelta = usd
		} else {
			// dispute (negative) and dispute_reversal (positive) net out here.
			period.disputedUsd += -usd
			period.feesUsd += t.fee / 100
			dayDelta = usd
		}

		if (period === window) {
			const day = new Date(ms).toISOString().slice(0, 10)
			byDay[day] = (byDay[day] ?? 0) + dayDelta
		}
	}

	for (const p of [window, previous]) {
		p.netUsd = round2(p.receivedUsd - p.refundedUsd - p.disputedUsd - p.feesUsd)
		p.receivedUsd = round2(p.receivedUsd)
		p.refundedUsd = round2(p.refundedUsd)
		p.disputedUsd = round2(p.disputedUsd)
		p.feesUsd = round2(p.feesUsd)
	}
	for (const day of Object.keys(byDay)) byDay[day] = round2(byDay[day] ?? 0)

	return { window, previous, byDay, nonUsdSkipped, truncated }
}
