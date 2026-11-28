/**
 * Timezone-aware recurring schedule math (pure). All stepping is done on LOCAL calendar dates (never by adding
 * 24h of milliseconds), so DST transitions and month ends are handled correctly. The periodKey is the local
 * run date, which makes execution idempotent per period.
 */
export type Frequency = 'weekly' | 'biweekly' | 'monthly'

export interface ScheduleSpec {
	frequency: Frequency
	timezone: string
	/** weekly/biweekly: 0=Sun..6=Sat */
	dayOfWeek?: number | null | undefined
	/** monthly: 1-31, clamped to the month's last day */
	dayOfMonth?: number | null | undefined
	/** 'HH:MM' local */
	localTime: string
}

export interface LocalDate {
	y: number
	m: number // 1-12
	d: number
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
const dtf = (tz: string) => {
	let f = fmtCache.get(tz)
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
		fmtCache.set(tz, f)
	}
	return f
}

export const assertTimezone = (tz: string): void => {
	try {
		dtf(tz).format(new Date())
	} catch {
		throw new Error(`invalid IANA timezone: ${tz}`)
	}
}

/** Offset (ms) of `tz` from UTC at instant `t`. */
function tzOffsetMs(t: number, tz: string): number {
	const parts = Object.fromEntries(dtf(tz).formatToParts(new Date(t)).map((p) => [p.type, p.value]))
	const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
	return asUtc - Math.floor(t / 1000) * 1000
}

export function localDateOf(t: Date, tz: string): LocalDate {
	const parts = Object.fromEntries(dtf(tz).formatToParts(t).map((p) => [p.type, p.value]))
	return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) }
}

/** UTC instant for a wall-clock time in `tz`. A nonexistent (spring-forward) time resolves to the same wall time after the gap. */
export function zonedToUtc(ld: LocalDate, hh: number, mm: number, tz: string): Date {
	const guess = Date.UTC(ld.y, ld.m - 1, ld.d, hh, mm, 0)
	const o1 = tzOffsetMs(guess, tz)
	let t = guess - o1
	const o2 = tzOffsetMs(t, tz)
	if (o2 !== o1) t = guess - o2
	return new Date(t)
}

const addDays = (ld: LocalDate, n: number): LocalDate => {
	const dt = new Date(Date.UTC(ld.y, ld.m - 1, ld.d + n))
	return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}
const dow = (ld: LocalDate) => new Date(Date.UTC(ld.y, ld.m - 1, ld.d)).getUTCDay()
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const monthlyDate = (y: number, m: number, dom: number): LocalDate => ({ y, m, d: Math.min(dom, daysInMonth(y, m)) })

export const periodKey = (ld: LocalDate): string => `${ld.y}-${String(ld.m).padStart(2, '0')}-${String(ld.d).padStart(2, '0')}`
export const parseLocalDate = (s: string): LocalDate => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
	if (!m) throw new Error(`bad period key ${s}`)
	return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

const parseTime = (s: string): [number, number] => {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s)
	if (!m) throw new Error(`localTime must be HH:MM, got ${s}`)
	return [Number(m[1]), Number(m[2])]
}

export function validateSpec(spec: ScheduleSpec): void {
	assertTimezone(spec.timezone)
	parseTime(spec.localTime)
	if (spec.frequency === 'monthly') {
		if (!spec.dayOfMonth || spec.dayOfMonth < 1 || spec.dayOfMonth > 31) throw new Error('monthly schedules need dayOfMonth 1-31')
	} else if (spec.dayOfWeek == null || spec.dayOfWeek < 0 || spec.dayOfWeek > 6) throw new Error('weekly/biweekly schedules need dayOfWeek 0-6')
}

/** First run strictly after `after`. */
export function firstRun(spec: ScheduleSpec, after: Date): { at: Date; periodKey: string } {
	validateSpec(spec)
	const [hh, mm] = parseTime(spec.localTime)
	let ld = localDateOf(after, spec.timezone)
	for (let i = 0; i < 400; i++) {
		const match =
			spec.frequency === 'monthly' ? ld.d === monthlyDate(ld.y, ld.m, spec.dayOfMonth!).d : dow(ld) === spec.dayOfWeek
		if (match) {
			const at = zonedToUtc(ld, hh, mm, spec.timezone)
			if (at.getTime() > after.getTime()) return { at, periodKey: periodKey(ld) }
		}
		ld = addDays(ld, 1)
	}
	throw new Error('could not compute next run')
}

/** The run following the one on local date `last`. */
export function nextAfter(spec: ScheduleSpec, last: LocalDate): { at: Date; periodKey: string } {
	const [hh, mm] = parseTime(spec.localTime)
	let ld: LocalDate
	if (spec.frequency === 'weekly') ld = addDays(last, 7)
	else if (spec.frequency === 'biweekly') ld = addDays(last, 14)
	else {
		const y = last.m === 12 ? last.y + 1 : last.y
		const m = last.m === 12 ? 1 : last.m + 1
		ld = monthlyDate(y, m, spec.dayOfMonth!)
	}
	return { at: zonedToUtc(ld, hh, mm, spec.timezone), periodKey: periodKey(ld) }
}

/** Period bounds (UTC instants) for accrual: the period ending at the run on `end`. */
export function periodBounds(spec: ScheduleSpec, end: LocalDate): { start: Date; end: Date } {
	const [hh, mm] = parseTime(spec.localTime)
	let startLd: LocalDate
	if (spec.frequency === 'weekly') startLd = addDays(end, -7)
	else if (spec.frequency === 'biweekly') startLd = addDays(end, -14)
	else {
		const y = end.m === 1 ? end.y - 1 : end.y
		const m = end.m === 1 ? 12 : end.m - 1
		startLd = monthlyDate(y, m, spec.dayOfMonth!)
	}
	return { start: zonedToUtc(startLd, hh, mm, spec.timezone), end: zonedToUtc(end, hh, mm, spec.timezone) }
}
