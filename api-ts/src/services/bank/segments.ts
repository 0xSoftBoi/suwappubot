/**
 * M13 segment profiles. Pure typed config, exported for every bank module via getSegmentProfile().
 * The account's segment lives in bank_accounts.segment_profile (db/schema/bank.ts `segmentProfile`).
 * Limits are integer minor units in 6-decimal stablecoin units (1_000_000 = 1.00).
 */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { type BankAccount, bankAccounts, bankOrgAudit } from '../../db'
import type { DrizzleService } from '../../db'
import { type BankOwner, bankDb } from './db'
import { bankErr } from './errors'

export const SEGMENTS = ['creator', 'athlete', 'digital_nomad', 'cross_border_sme', 'sharia_compliant', 'remittance_receiver', 'agent'] as const
export type Segment = (typeof SEGMENTS)[number]

export interface SegmentFeatures {
	/** Interest-bearing yield (M2 earn vaults). */
	earn: boolean
	/** Interest credited to balances / interest-bearing credit lines. */
	interestCredit: boolean
	/** Fee-based / fixed-markup (murabaha-style) financing instead of interest-bearing credit. */
	fixedMarkupFinancing: boolean
	cards: boolean
	fxConversion: boolean
	remittanceSend: boolean
	payroll: boolean
	invoicing: boolean
	streaming: boolean
	agentPayments: boolean
	privatePayouts: boolean
}

export interface SegmentProfile {
	segment: Segment
	title: string
	defaultCurrencies: string[]
	defaultChains: string[]
	features: SegmentFeatures
	limits: { perTxMinor: string; dailyMinor: string }
	onboardingChecklist: string[]
	recommendedRails: string[]
	notes?: string
}

const base: SegmentFeatures = {
	earn: true, interestCredit: true, fixedMarkupFinancing: false, cards: true, fxConversion: true,
	remittanceSend: true, payroll: false, invoicing: false, streaming: false, agentPayments: false, privatePayouts: false,
}
const f = (o: Partial<SegmentFeatures>): SegmentFeatures => ({ ...base, ...o })
const U = (n: number) => String(n * 1_000_000)

export const SEGMENT_PROFILES: Record<Segment, SegmentProfile> = {
	creator: {
		segment: 'creator', title: 'Creator',
		defaultCurrencies: ['USD', 'EUR'], defaultChains: ['base', 'polygon'],
		features: f({ invoicing: true, streaming: true }),
		limits: { perTxMinor: U(5_000), dailyMinor: U(10_000) },
		onboardingChecklist: ['verify_identity', 'open_usd_account', 'link_payout_handle', 'create_first_payment_request'],
		recommendedRails: ['usdc_base', 'virtual_account_ach', 'virtual_account_sepa'],
	},
	athlete: {
		segment: 'athlete', title: 'Athlete',
		defaultCurrencies: ['USD', 'EUR'], defaultChains: ['base', 'ethereum'],
		features: f({ invoicing: true, payroll: false }),
		limits: { perTxMinor: U(25_000), dailyMinor: U(50_000) },
		onboardingChecklist: ['verify_identity', 'open_usd_account', 'open_eur_account', 'add_tax_residency'],
		recommendedRails: ['usdc_base', 'eurc_base', 'virtual_account_ach', 'virtual_account_sepa'],
	},
	digital_nomad: {
		segment: 'digital_nomad', title: 'Digital nomad',
		defaultCurrencies: ['USD', 'EUR'], defaultChains: ['base', 'polygon', 'arbitrum'],
		features: f({ invoicing: true }),
		limits: { perTxMinor: U(10_000), dailyMinor: U(20_000) },
		onboardingChecklist: ['verify_identity', 'open_usd_account', 'open_eur_account', 'enable_card', 'set_home_currency'],
		recommendedRails: ['usdc_base', 'eurc_base', 'virtual_account_ach', 'virtual_account_sepa', 'card'],
	},
	cross_border_sme: {
		segment: 'cross_border_sme', title: 'Cross-border SME',
		defaultCurrencies: ['USD', 'EUR', 'MXN', 'BRL'], defaultChains: ['base', 'polygon', 'arbitrum', 'tempo'],
		features: f({ payroll: true, invoicing: true, streaming: true, privatePayouts: true }),
		limits: { perTxMinor: U(100_000), dailyMinor: U(250_000) },
		onboardingChecklist: ['verify_business', 'add_beneficial_owners', 'open_usd_account', 'add_payees', 'configure_approval_policy'],
		recommendedRails: ['usdc_base', 'tempo_pathusd', 'virtual_account_ach', 'virtual_account_sepa', 'spei_payout'],
	},
	sharia_compliant: {
		segment: 'sharia_compliant', title: 'Sharia-compliant (interest-free)',
		defaultCurrencies: ['USD', 'EUR'], defaultChains: ['base', 'polygon'],
		// No riba: no interest-bearing earn, no interest credit. Fee-based / fixed-markup (murabaha-style) financing allowed.
		features: f({ earn: false, interestCredit: false, fixedMarkupFinancing: true, invoicing: true }),
		limits: { perTxMinor: U(10_000), dailyMinor: U(25_000) },
		onboardingChecklist: ['verify_identity', 'open_usd_account', 'acknowledge_interest_free_terms', 'review_fixed_markup_financing_terms'],
		recommendedRails: ['usdc_base', 'eurc_base', 'virtual_account_ach'],
		notes: 'Interest-free mode. Financing is a disclosed fixed markup agreed up front; no accruing interest. Product terms need review by a qualified Sharia board before marketing as certified.',
	},
	remittance_receiver: {
		segment: 'remittance_receiver', title: 'Remittance receiver',
		defaultCurrencies: ['USD', 'MXN', 'BRL'], defaultChains: ['base', 'polygon'],
		features: f({ cards: true, remittanceSend: false, payroll: false }),
		limits: { perTxMinor: U(2_000), dailyMinor: U(5_000) },
		onboardingChecklist: ['verify_identity', 'open_usd_account', 'share_payment_handle', 'enable_card_or_local_cashout'],
		recommendedRails: ['usdc_base', 'spei_payout', 'pix_deposit'],
	},
	agent: {
		segment: 'agent', title: 'AI agent',
		defaultCurrencies: ['USD'], defaultChains: ['base'],
		features: f({ earn: false, interestCredit: false, cards: false, remittanceSend: false, streaming: true, agentPayments: true }),
		limits: { perTxMinor: U(100), dailyMinor: U(1_000) },
		onboardingChecklist: ['provision_agent_wallet', 'open_agent_account', 'set_spend_mandate'],
		recommendedRails: ['usdc_base', 'x402'],
	},
}

export const isSegment = (s: unknown): s is Segment => typeof s === 'string' && (SEGMENTS as readonly string[]).includes(s)

export function getSegmentProfile(segment: string | null | undefined): SegmentProfile | null {
	return isSegment(segment) ? SEGMENT_PROFILES[segment] : null
}

/** Default (no segment) feature set: everything standard on. */
export const DEFAULT_FEATURES: SegmentFeatures = base

export interface EffectiveFeatures {
	accountId: string
	segment: Segment | null
	features: SegmentFeatures
	limits: { perTxMinor: string; dailyMinor: string } | null
	profile: SegmentProfile | null
}

export const effectiveFeatures = (acct: Pick<BankAccount, 'id' | 'segmentProfile' | 'metadata'>): EffectiveFeatures => {
	const p = getSegmentProfile(acct.segmentProfile)
	const lim = ((acct.metadata ?? {}) as { limits?: { perTxMinor?: string; dailyMinor?: string } }).limits
	return {
		accountId: acct.id,
		segment: p?.segment ?? null,
		features: p?.features ?? DEFAULT_FEATURES,
		// explicit per-account limits (set by the owner/ops) win over segment defaults
		limits: lim?.perTxMinor && lim?.dailyMinor ? { perTxMinor: lim.perTxMinor, dailyMinor: lim.dailyMinor } : (p?.limits ?? null),
		profile: p,
	}
}

/** True when a feature is enabled for the account's segment (use as a guard in earn/credit modules). */
export const featureEnabled = (acct: Pick<BankAccount, 'segmentProfile'>, feature: keyof SegmentFeatures): boolean =>
	(getSegmentProfile(acct.segmentProfile)?.features ?? DEFAULT_FEATURES)[feature]

export const setAccountSegment = (owner: BankOwner, accountId: string, segment: Segment | null): Effect.Effect<BankAccount, ReturnType<typeof bankErr>, DrizzleService> =>
	bankDb(async (db) => {
		const [a] = await db
			.select()
			.from(bankAccounts)
			.where(and(eq(bankAccounts.id, accountId), eq(bankAccounts.ownerType, owner.ownerType), eq(bankAccounts.ownerId, owner.ownerId)))
			.limit(1)
		if (!a) throw bankErr('NOT_FOUND', 'Account not found')
		if (segment === 'sharia_compliant') {
			const md = (a.metadata ?? {}) as Record<string, unknown>
			if (md.earnPosition || md.interestBearing) throw bankErr('CONFLICT', 'Account has interest-bearing positions; close them before switching to sharia_compliant')
		}
		// MONEY-PATH: segment restrictions cannot be shed by the owner.
		if (a.segmentProfile === segment) return a
		if (a.segmentProfile === 'agent' && (a.ownerType === 'agent' || segment !== 'agent')) throw bankErr('FORBIDDEN', "Agent accounts cannot leave the 'agent' segment")
		if (a.ownerType === 'agent' && segment !== 'agent') throw bankErr('FORBIDDEN', "Agent-owned accounts must stay in the 'agent' segment")
		const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as unknown[]
		const open = rowsOf(
			await db.execute(sql`select 'credit' as k from bank_credit_lines where status = 'active' and (account_id = ${accountId} or collateral_savings_account_id = ${accountId})
				union all select 'earn' from bank_earn_positions where (savings_account_id = ${accountId} or checking_account_id = ${accountId}) and (shares_minor > 0 or pledged_shares_minor > 0)
				union all select 'card' from bank_cards where account_id = ${accountId} and status not in ('canceled','cancelled','closed','terminated') limit 1`),
		)
		if (open.length) throw bankErr('CONFLICT', 'Segment cannot change while credit, financing, earn positions or card links are open on this account')
		const [row] = await db.update(bankAccounts).set({ segmentProfile: segment, updatedAt: new Date() }).where(eq(bankAccounts.id, accountId)).returning()
		await db.insert(bankOrgAudit).values({ id: `aud_${randomUUID().replace(/-/g, '')}`, orgId: a.ownerType === 'org' ? a.ownerId : `${a.ownerType}:${a.ownerId}`.slice(0, 120), actorKind: owner.ownerType === 'agent' ? 'agent' : 'user', actorAgentId: owner.ownerType === 'agent' ? owner.ownerId : null, action: 'account.segment.change', targetType: 'account', targetId: accountId, detail: { from: a.segmentProfile, to: segment } })
		return row!
	})
