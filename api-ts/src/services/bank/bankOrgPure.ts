/**
 * Pure (no IO) business-banking logic: permission matrix, approval quorum,
 * signed tokens, rate conversion, runway, FX exposure, ageing. Kept separate so
 * it can be exercised without a database. Money = bigint minor units.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// ─── Roles & permission matrix ──────────────────────────────────────────────

export const ORG_ROLES = ['owner', 'admin', 'approver', 'accountant', 'member', 'viewer'] as const
export type OrgRole = (typeof ORG_ROLES)[number]

export const ORG_ACTIONS = [
	'org.view',
	'org.manage',
	'members.view',
	'members.invite',
	'members.manage',
	'accounts.view',
	'accounts.open',
	'transfer.view',
	'transfer.create',
	'payee.view',
	'approval.view',
	'approval.request',
	'approval.decide',
	'policy.manage',
	'treasury.view',
	'treasury.manage',
	'vendors.manage',
	'bills.view',
	'bills.create',
	'bills.pay',
	'collections.view',
	'collections.manage',
	'books.view',
	'books.categorize',
	'books.export',
	'books.close',
	'audit.view',
	'cards.budget.view',
	'cards.budget.manage',
	'payroll.run',
] as const
export type OrgAction = (typeof ORG_ACTIONS)[number]

const READ: OrgAction[] = [
	'org.view',
	'members.view',
	'accounts.view',
	'transfer.view',
	'payee.view',
	'approval.view',
	'treasury.view',
	'bills.view',
	'collections.view',
	'books.view',
	'cards.budget.view',
]

/** THE permission table. Other modules: `import { can } from '.../bankOrgPure'`. */
export const PERMISSION_MATRIX: Readonly<Record<OrgRole, ReadonlySet<OrgAction>>> = {
	owner: new Set(ORG_ACTIONS),
	admin: new Set(ORG_ACTIONS), // admin is limited from owner-only member ops by canGrantRole/canManageMember
	approver: new Set<OrgAction>([...READ, 'approval.decide', 'audit.view']),
	accountant: new Set<OrgAction>([
		...READ,
		'vendors.manage',
		'bills.create',
		'collections.manage',
		'books.categorize',
		'books.export',
		'audit.view',
	]),
	member: new Set<OrgAction>([...READ, 'transfer.create', 'approval.request', 'bills.create']),
	viewer: new Set<OrgAction>(READ),
}

export function can(role: OrgRole | string, action: OrgAction): boolean {
	const set = (PERMISSION_MATRIX as Record<string, ReadonlySet<OrgAction>>)[role]
	return !!set && set.has(action)
}

/** Actions an agent (API-key bound to a member) can never perform even if the member's role allows it. */
export const AGENT_DENIED: ReadonlySet<OrgAction> = new Set<OrgAction>([
	'members.invite',
	'members.manage',
	'policy.manage',
	'approval.decide',
	'books.close',
	'org.manage',
	'treasury.manage',
	'accounts.open',
	'cards.budget.manage',
])

export function canActor(role: OrgRole | string, action: OrgAction, via: 'user' | 'agent'): boolean {
	if (via === 'agent' && AGENT_DENIED.has(action)) return false
	return can(role, action)
}

const RANK: Record<OrgRole, number> = { owner: 5, admin: 4, approver: 3, accountant: 3, member: 2, viewer: 1 }

/** Owners grant anything but 'owner' (single owner; transfer is out of band). Admins may grant below admin. */
export function canGrantRole(actor: OrgRole, target: OrgRole): boolean {
	if (target === 'owner') return false
	if (actor === 'owner') return true
	if (actor === 'admin') return RANK[target] < RANK.admin
	return false
}

/** Whether `actor` may change/remove a member currently holding `current`. */
export function canManageMember(actor: OrgRole, current: OrgRole): boolean {
	if (current === 'owner') return false
	if (actor === 'owner') return true
	if (actor === 'admin') return RANK[current] < RANK.admin
	return false
}

// ─── Canonical payload hashing & signed tokens ──────────────────────────────

export function canonicalJson(v: unknown): string {
	if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
	if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
	const o = v as Record<string, unknown>
	return `{${Object.keys(o)
		.filter((k) => o[k] !== undefined)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
		.join(',')}}`
}

export const hashPayload = (payload: unknown): string => createHash('sha256').update(canonicalJson(payload)).digest('hex')

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url')

/** Domain-separated HMAC key derived from the service secret. */
const deriveKey = (secret: string, domain: string): Buffer => createHmac('sha256', secret).update(`suwappu-bank:${domain}`).digest()

export function signToken(secret: string, domain: string, claims: Record<string, unknown>): string {
	const body = b64u(JSON.stringify(claims))
	const sig = b64u(createHmac('sha256', deriveKey(secret, domain)).update(`${domain}.${body}`).digest())
	return `${body}.${sig}`
}

export type TokenCheck<T> = { ok: true; claims: T } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

export function openToken<T extends { exp: number }>(secret: string, domain: string, token: string, nowMs: number): TokenCheck<T> {
	const parts = token.split('.')
	if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
	const expected = createHmac('sha256', deriveKey(secret, domain)).update(`${domain}.${parts[0]}`).digest()
	let given: Buffer
	try {
		given = Buffer.from(parts[1], 'base64url')
	} catch {
		return { ok: false, reason: 'malformed' }
	}
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' }
	let claims: T
	try {
		claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as T
	} catch {
		return { ok: false, reason: 'malformed' }
	}
	if (typeof claims.exp !== 'number' || claims.exp <= nowMs) return { ok: false, reason: 'expired' }
	return { ok: true, claims }
}

export interface ApprovalTokenClaims {
	v: 1
	org: string
	act: string
	ph: string
	req: string
	jti: string
	exp: number
}
export const APPROVAL_TOKEN_TTL_MS = 15 * 60 * 1000
const APPROVAL_DOMAIN = 'approval-token-v1'

export function mintApprovalToken(secret: string, a: { orgId: string; action: string; payload: unknown; requestId: string; nowMs: number; ttlMs?: number }): string {
	const claims: ApprovalTokenClaims = {
		v: 1,
		org: a.orgId,
		act: a.action,
		ph: hashPayload(a.payload),
		req: a.requestId,
		jti: randomBytes(8).toString('hex'),
		exp: a.nowMs + (a.ttlMs ?? APPROVAL_TOKEN_TTL_MS),
	}
	return signToken(secret, APPROVAL_DOMAIN, claims as unknown as Record<string, unknown>)
}

export type ApprovalTokenResult =
	| { ok: true; claims: ApprovalTokenClaims }
	| { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_org' | 'wrong_action' | 'payload_mismatch' }

/** Stateless verification: signature, expiry and binding to (org, action, payload hash). */
export function verifyApprovalTokenWith(
	secret: string,
	token: string,
	expect: { orgId: string; action: string; payload: unknown },
	nowMs: number = Date.now(),
): ApprovalTokenResult {
	const r = openToken<ApprovalTokenClaims>(secret, APPROVAL_DOMAIN, token, nowMs)
	if (!r.ok) return r
	if (r.claims.v !== 1 || r.claims.org !== expect.orgId) return { ok: false, reason: 'wrong_org' }
	if (r.claims.act !== expect.action) return { ok: false, reason: 'wrong_action' }
	if (r.claims.ph !== hashPayload(expect.payload)) return { ok: false, reason: 'payload_mismatch' }
	return { ok: true, claims: r.claims }
}

export interface InviteClaims {
	inv: string
	org: string
	role: OrgRole
	exp: number
}
const INVITE_DOMAIN = 'org-invite-v1'
export const signInvite = (secret: string, c: InviteClaims): string => signToken(secret, INVITE_DOMAIN, c as unknown as Record<string, unknown>)
export const openInvite = (secret: string, token: string, nowMs: number = Date.now()) => openToken<InviteClaims>(secret, INVITE_DOMAIN, token, nowMs)
export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

// ─── Approval policy matching & quorum ──────────────────────────────────────

export type RuleType = 'transfer_over' | 'new_payee' | 'payroll_run'
export interface PolicyLite {
	id: string
	ruleType: RuleType
	thresholdMinor: bigint | null
	requiredApprovals: number
	approverRoles: OrgRole[]
	expiryHours: number
	enabled: boolean
}
export interface ApprovalContext {
	action: 'transfer' | 'payroll_run' | 'new_payee'
	/** Transfer value in the org's reporting currency minor units. */
	amountReportingMinor?: bigint
	newPayee?: boolean
}

/** Returns the strictest matching policy (most approvals; ties keep the first), or null if none applies. */
export function matchPolicy(policies: PolicyLite[], ctx: ApprovalContext): PolicyLite | null {
	const hits = policies.filter((p) => {
		if (!p.enabled) return false
		if (p.ruleType === 'transfer_over')
			return ctx.action === 'transfer' && ctx.amountReportingMinor !== undefined && p.thresholdMinor !== null && ctx.amountReportingMinor > p.thresholdMinor
		if (p.ruleType === 'new_payee') return (ctx.action === 'transfer' || ctx.action === 'new_payee') && ctx.newPayee === true
		return p.ruleType === 'payroll_run' && ctx.action === 'payroll_run'
	})
	let best: PolicyLite | null = null
	for (const p of hits) if (!best || p.requiredApprovals > best.requiredApprovals) best = p
	return best
}

export interface DecisionLite {
	userId: number
	role: OrgRole
	decision: 'approve' | 'reject'
}
export type DecisionRefusal = 'NOT_PENDING' | 'EXPIRED' | 'SELF_APPROVAL' | 'ROLE_NOT_ELIGIBLE' | 'ALREADY_DECIDED' | 'NO_PERMISSION'

export function validateDecision(a: {
	status: string
	expiresAt: Date
	requestedBy: number
	approverRoles: OrgRole[]
	decider: { userId: number; role: OrgRole; via: 'user' | 'agent' }
	existing: DecisionLite[]
	now: Date
}): DecisionRefusal | null {
	if (a.status !== 'pending') return 'NOT_PENDING'
	if (a.expiresAt.getTime() <= a.now.getTime()) return 'EXPIRED'
	if (a.decider.userId === a.requestedBy) return 'SELF_APPROVAL'
	if (!canActor(a.decider.role, 'approval.decide', a.decider.via)) return 'NO_PERMISSION'
	if (!a.approverRoles.includes(a.decider.role)) return 'ROLE_NOT_ELIGIBLE'
	if (a.existing.some((d) => d.userId === a.decider.userId)) return 'ALREADY_DECIDED'
	return null
}

/** Any eligible rejection rejects; otherwise approved once N distinct eligible approvers (never the requester) approved. */
export function tally(a: { required: number; approverRoles: OrgRole[]; requestedBy: number; decisions: DecisionLite[] }): 'approved' | 'rejected' | 'pending' {
	const eligible = a.decisions.filter((d) => d.userId !== a.requestedBy && a.approverRoles.includes(d.role))
	if (eligible.some((d) => d.decision === 'reject')) return 'rejected'
	const approvers = new Set(eligible.filter((d) => d.decision === 'approve').map((d) => d.userId))
	return approvers.size >= a.required ? 'approved' : 'pending'
}

// ─── Currency conversion ────────────────────────────────────────────────────

const RATE_SCALE = 12
const pow10 = (n: number): bigint => 10n ** BigInt(n)

export function parseRate(rate: string): bigint {
	const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim())
	if (!m) throw new Error(`invalid rate "${rate}"`)
	const frac = (m[2] ?? '').padEnd(RATE_SCALE, '0').slice(0, RATE_SCALE)
	return BigInt(m[1]!) * pow10(RATE_SCALE) + BigInt(frac || '0')
}

export function rateToString(n: number): string {
	if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid rate ${n}`)
	return n.toFixed(RATE_SCALE).replace(/0+$/, '').replace(/\.$/, '')
}

/** ISO minor-unit decimals for reporting currencies. */
export function currencyDecimals(cur: string): number {
	return ({ JPY: 0, KRW: 0, CLP: 0, BHD: 3, KWD: 3 } as Record<string, number>)[cur.toUpperCase()] ?? 2
}

/** amount (asset minor) × rate (reporting units per whole asset unit) → reporting minor, half-up. */
export function convertMinor(amountMinor: bigint, assetDecimals: number, rate: string, reportDecimals: number): bigint {
	const num = amountMinor * parseRate(rate) * pow10(reportDecimals)
	const den = pow10(assetDecimals) * pow10(RATE_SCALE)
	const neg = num < 0n
	const abs = neg ? -num : num
	const q = (abs * 2n + den) / (den * 2n)
	return neg ? -q : q
}

// ─── Treasury math ──────────────────────────────────────────────────────────

export interface RunwayResult {
	balanceMinor: string
	netOutflow30Minor: string
	netOutflow90Minor: string
	/** Floor days of cash at the trailing-30 / trailing-90 net burn; null = not burning (net inflow or flat). */
	runwayDays30: number | null
	runwayDays90: number | null
	status: 'burning' | 'not_burning'
}

export function runway(balanceMinor: bigint, netOutflow30Minor: bigint, netOutflow90Minor: bigint): RunwayResult {
	const days = (net: bigint, window: bigint): number | null => (net > 0n ? Number((balanceMinor > 0n ? balanceMinor : 0n) * window / net) : null)
	const d30 = days(netOutflow30Minor, 30n)
	const d90 = days(netOutflow90Minor, 90n)
	return {
		balanceMinor: balanceMinor.toString(),
		netOutflow30Minor: netOutflow30Minor.toString(),
		netOutflow90Minor: netOutflow90Minor.toString(),
		runwayDays30: d30,
		runwayDays90: d90,
		status: d30 === null && d90 === null ? 'not_burning' : 'burning',
	}
}

export interface HoldingLite {
	currency: string
	asset: string
	reportingMinor: bigint
}

export function fxExposure(holdings: HoldingLite[], reportingCurrency: string) {
	const by = new Map<string, bigint>()
	let total = 0n
	for (const h of holdings) {
		by.set(h.currency, (by.get(h.currency) ?? 0n) + h.reportingMinor)
		total += h.reportingMinor
	}
	const rows = [...by.entries()].map(([currency, v]) => ({
		currency,
		reportingMinor: v.toString(),
		// basis points of total, integer
		shareBps: total > 0n ? Number((v * 10000n) / total) : 0,
		foreign: currency !== reportingCurrency.toUpperCase(),
	}))
	const foreign = rows.filter((r) => r.foreign).reduce((s, r) => s + BigInt(r.reportingMinor), 0n)
	return { reportingCurrency, totalMinor: total.toString(), foreignMinor: foreign.toString(), foreignShareBps: total > 0n ? Number((foreign * 10000n) / total) : 0, byCurrency: rows }
}

/** Excess above the operating floor, only if it clears the minimum sweep. */
export function sweepAmount(balance: bigint, floor: bigint, minSweep: bigint): bigint {
	const excess = balance - floor
	return excess > 0n && excess >= minSweep && excess > 0n ? excess : 0n
}

// ─── Receivables ageing & dunning ───────────────────────────────────────────

export const AGEING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const
export function ageingBucket(dueMs: number, nowMs: number): (typeof AGEING_BUCKETS)[number] {
	const days = Math.floor((nowMs - dueMs) / 86_400_000)
	if (days <= 0) return 'current'
	if (days <= 30) return '1-30'
	if (days <= 60) return '31-60'
	if (days <= 90) return '61-90'
	return '90+'
}

/** Overdue-day offsets of each dunning stage (reminder, 1st, 2nd, final). */
export const DUNNING_SCHEDULE_DAYS = [1, 7, 14, 30] as const
/** Highest stage (1-based) reached after `daysOverdue`; 0 = none yet. */
export function dunningStage(daysOverdue: number): number {
	let s = 0
	DUNNING_SCHEDULE_DAYS.forEach((d, i) => {
		if (daysOverdue >= d) s = i + 1
	})
	return s
}
