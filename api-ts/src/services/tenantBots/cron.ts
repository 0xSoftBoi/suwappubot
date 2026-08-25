/**
 * A small, exact cron evaluator for automation schedules.
 *
 * Pulling in a cron dependency for this would be reasonable; writing it is
 * ~120 lines and keeps a package that computes *when we spend money* inside
 * the repo where it can be read and tested. The scope is deliberately narrow:
 * five fields, UTC, `*`, ranges, lists and steps. No `@hourly` aliases, no
 * seconds field, no day-name words, no timezones.
 *
 * Two decisions worth knowing:
 *
 * - **Everything is UTC.** A burn schedule that silently shifted an hour twice
 *   a year because a server was on a local zone would be a genuinely nasty bug
 *   to diagnose from a treasury statement.
 * - **Unparseable means null, never "now".** `nextRunAfter` returns null for
 *   anything it does not fully understand, and the scheduler treats null as
 *   "never run automatically". A cron parser that guesses is a parser that
 *   eventually fires a spend at a time nobody asked for.
 *
 * The classic cron day-of-month/day-of-week OR rule is implemented: when both
 * are restricted, a date matching *either* runs. That surprises people, so it
 * is called out here rather than discovered in production.
 */

export interface CronFields {
	minutes: number[]
	hours: number[]
	daysOfMonth: number[]
	months: number[]
	daysOfWeek: number[]
	/** True when the field was a bare `*` — needed for the DOM/DOW OR rule. */
	domRestricted: boolean
	dowRestricted: boolean
}

const RANGES: Record<string, [number, number]> = {
	minute: [0, 59],
	hour: [0, 23],
	dayOfMonth: [1, 31],
	month: [1, 12],
	dayOfWeek: [0, 6],
}

/**
 * Expand one field into the sorted list of values it matches.
 * Returns null if any part of the field is invalid — callers must not treat a
 * partially-understood field as a match-all.
 */
export function expandField(raw: string, kind: keyof typeof RANGES): number[] | null {
	const [min, max] = RANGES[kind]
	const out = new Set<number>()

	for (const part of raw.split(',')) {
		const piece = part.trim()
		if (!piece) return null

		// step: <range>/<n>
		let stepped = piece
		let step = 1
		const slash = piece.indexOf('/')
		if (slash !== -1) {
			stepped = piece.slice(0, slash)
			const stepRaw = piece.slice(slash + 1)
			if (!/^\d+$/.test(stepRaw)) return null
			step = Number.parseInt(stepRaw, 10)
			if (step < 1) return null
		}

		let lo: number
		let hi: number
		if (stepped === '*') {
			lo = min
			hi = max
		} else if (stepped.includes('-')) {
			const [a, b] = stepped.split('-')
			if (!/^\d+$/.test(a ?? '') || !/^\d+$/.test(b ?? '')) return null
			lo = Number.parseInt(a as string, 10)
			hi = Number.parseInt(b as string, 10)
		} else {
			if (!/^\d+$/.test(stepped)) return null
			lo = Number.parseInt(stepped, 10)
			// A bare value with a step means "from here to the end of the range",
			// which is how every cron implementation reads `5/10`.
			hi = slash === -1 ? lo : max
		}

		if (lo < min || hi > max || lo > hi) return null
		for (let v = lo; v <= hi; v += step) out.add(v)
	}

	if (out.size === 0) return null
	return [...out].sort((a, b) => a - b)
}

/** Parse a 5-field UTC cron expression. Null if anything is off. */
export function parseCron(expr: string): CronFields | null {
	if (typeof expr !== 'string') return null
	const parts = expr.trim().split(/\s+/)
	if (parts.length !== 5) return null
	const [m, h, dom, mon, dow] = parts as [string, string, string, string, string]

	const minutes = expandField(m, 'minute')
	const hours = expandField(h, 'hour')
	const daysOfMonth = expandField(dom, 'dayOfMonth')
	const months = expandField(mon, 'month')
	const daysOfWeek = expandField(dow, 'dayOfWeek')
	if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null

	return {
		minutes,
		hours,
		daysOfMonth,
		months,
		daysOfWeek,
		domRestricted: dom !== '*',
		dowRestricted: dow !== '*',
	}
}

function matchesDate(f: CronFields, d: Date): boolean {
	if (!f.months.includes(d.getUTCMonth() + 1)) return false
	const domHit = f.daysOfMonth.includes(d.getUTCDate())
	const dowHit = f.daysOfWeek.includes(d.getUTCDay())

	// Classic cron: if both day fields are restricted, EITHER matching runs.
	if (f.domRestricted && f.dowRestricted) return domHit || dowHit
	if (f.domRestricted) return domHit
	if (f.dowRestricted) return dowHit
	return true
}

/** How far ahead we are willing to search before declaring a schedule dead. */
const MAX_LOOKAHEAD_DAYS = 4 * 366

/**
 * The first moment strictly after `from` that the expression matches.
 *
 * Minute-granular; seconds and milliseconds in `from` are ignored (the search
 * starts at the next whole minute), so calling this repeatedly with the
 * returned value walks the schedule without ever repeating a slot.
 */
export function nextRunAfter(expr: string | null | undefined, from: Date): Date | null {
	if (!expr) return null
	const fields = parseCron(expr)
	if (!fields) return null

	const cursor = new Date(from.getTime())
	cursor.setUTCSeconds(0, 0)
	cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)

	const limit = new Date(cursor.getTime() + MAX_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000)

	while (cursor <= limit) {
		if (!matchesDate(fields, cursor)) {
			// Skip a whole day rather than 1,440 pointless minute checks.
			cursor.setUTCDate(cursor.getUTCDate() + 1)
			cursor.setUTCHours(0, 0, 0, 0)
			continue
		}
		if (!fields.hours.includes(cursor.getUTCHours())) {
			cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0)
			continue
		}
		if (!fields.minutes.includes(cursor.getUTCMinutes())) {
			cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0)
			continue
		}
		return cursor
	}
	return null
}

/**
 * A stable identifier for "this automation, this scheduled slot".
 *
 * The executor writes it on every run row under a unique index, so a tick that
 * fires twice — two replicas, a restart mid-run, a manual trigger racing the
 * scheduler — collides on insert instead of spending twice. This is the last
 * line of defence behind the row claim, and the one that survives a process
 * dying between claiming and spending.
 */
export function slotKey(automationId: string, slot: Date): string {
	return `${automationId}:${slot.toISOString().slice(0, 16)}`
}
