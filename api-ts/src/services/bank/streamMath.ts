/**
 * Streaming / metered accrual — pure bigint math, no I/O.
 * Rate streams: accrued = floor(rateMinor * activeSeconds / periodSeconds), exact (no per-tick rounding drift
 * because the multiplication happens before the single division). Pause folds whole elapsed seconds into
 * `activeSeconds` (sub-second remainder is dropped, in the payer's favour); resume restarts the clock.
 */
export interface StreamAccrualState {
	kind: 'rate' | 'metered'
	rateMinor: bigint | null
	periodSeconds: number | null
	unitPriceMinor: bigint | null
	capMinor: bigint
	activeSeconds: bigint
	resumedAt: Date | null
	units: bigint
}

export const elapsedSeconds = (from: Date, now: Date): bigint => {
	const ms = now.getTime() - from.getTime()
	return ms > 0 ? BigInt(Math.floor(ms / 1000)) : 0n
}

export const activeSecondsAt = (s: Pick<StreamAccrualState, 'activeSeconds' | 'resumedAt'>, now: Date): bigint =>
	s.activeSeconds + (s.resumedAt ? elapsedSeconds(s.resumedAt, now) : 0n)

const min = (a: bigint, b: bigint) => (a < b ? a : b)

/** Total accrued (not net of settlements), capped. */
export function accruedMinor(s: StreamAccrualState, now: Date): bigint {
	let raw: bigint
	if (s.kind === 'rate') {
		if (s.rateMinor == null || !s.periodSeconds) throw new Error('rate stream missing rate/period')
		raw = (s.rateMinor * activeSecondsAt(s, now)) / BigInt(s.periodSeconds)
	} else {
		if (s.unitPriceMinor == null) throw new Error('metered stream missing unit price')
		raw = s.units * s.unitPriceMinor
	}
	return min(raw, s.capMinor)
}

/** Fold the running clock into the checkpoint (used on pause/cancel). */
export function foldCheckpoint(s: Pick<StreamAccrualState, 'activeSeconds' | 'resumedAt'>, now: Date): bigint {
	return activeSecondsAt(s, now)
}

/** Settlement decision: amount to pay now given what is already settled. `force` ignores the dust threshold. */
export function settleAmount(accrued: bigint, settled: bigint, dustMinor: bigint, force: boolean): bigint {
	const pending = accrued - settled
	if (pending <= 0n) return 0n
	if (!force && pending < dustMinor) return 0n
	return pending
}
