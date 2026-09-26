/**
 * Backfill agents' internal_* wallet IDs to point at their own Turnkey wallet.
 *
 * Before the trust-layer fixes, /internal/agent/provision-wallet minted a
 * separate Python wallet, so an agent's internal_wallet_id signs from an
 * address that differs from metadata.wallet_address. The execute-swap guard
 * now 403s those agents. Re-calling POST /v1/agent/wallets is NOT a fix: it
 * creates a new Turnkey wallet and overwrites wallet_address, stranding funds.
 *
 * For each agent with metadata.wallet_address this script:
 *   1. finds the Turnkey walletId in metadata.wallet_sub_org_id whose account
 *      address matches wallet_address,
 *   2. (--apply) calls provision-wallet, which idempotently registers that
 *      Turnkey wallet as the agent's Python Wallet row,
 *   3. (--apply) writes the returned internal_* IDs with an atomic jsonb merge,
 *      only if wallet_address is still the one we resolved.
 *
 * Dry run by default (reads only). Safe to re-run.
 *
 *   bun run scripts/backfill-agent-wallets.ts [--apply] [--agent <id>] [--limit <n>]
 *
 * Env: DATABASE_URL, TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY,
 *      TURNKEY_ORGANIZATION_ID, [TURNKEY_BASE_URL], and with --apply
 *      INTERNAL_API_URL + INTERNAL_API_KEY (python-api).
 */
import { Turnkey } from '@turnkey/sdk-server'
import { and, eq, sql } from 'drizzle-orm'
import { createDbClient } from '../src/db/client'
import { agents } from '../src/db/schema'

type Outcome = 'would-fix' | 'fixed' | 'already-ok' | 'skipped' | 'error'

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name)
	return i === -1 ? undefined : process.argv[i + 1]
}

function requireEnv(name: string): string {
	const v = process.env[name]
	if (!v) {
		console.error(`Missing env ${name}`)
		process.exit(2)
	}
	return v
}

const apply = process.argv.includes('--apply')
const onlyAgent = arg('--agent') ? Number(arg('--agent')) : undefined
const limit = arg('--limit') ? Number(arg('--limit')) : undefined

const db = createDbClient(requireEnv('DATABASE_URL'))
const turnkey = new Turnkey({
	apiBaseUrl: process.env.TURNKEY_BASE_URL || 'https://api.turnkey.com',
	apiPublicKey: requireEnv('TURNKEY_API_PUBLIC_KEY'),
	apiPrivateKey: requireEnv('TURNKEY_API_PRIVATE_KEY'),
	defaultOrganizationId: requireEnv('TURNKEY_ORGANIZATION_ID'),
}).apiClient()
const internalUrl = apply ? requireEnv('INTERNAL_API_URL') : ''
const internalKey = apply ? requireEnv('INTERNAL_API_KEY') : ''

async function findTurnkeyWalletId(subOrgId: string, address: string): Promise<string | null> {
	const { accounts } = await turnkey.getWalletAccounts({ organizationId: subOrgId })
	const match = accounts.find((a) => a.address.toLowerCase() === address.toLowerCase())
	return match?.walletId ?? null
}

async function provision(agentUuid: string, walletId: string, subOrgId: string, address: string) {
	const res = await fetch(`${internalUrl}/internal/agent/provision-wallet`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalKey },
		body: JSON.stringify({
			agent_uuid: agentUuid,
			chain_type: 'evm',
			turnkey_wallet_id: walletId,
			turnkey_sub_org_id: subOrgId,
			address,
		}),
		signal: AbortSignal.timeout(15_000),
	})
	if (!res.ok) throw new Error(`provision-wallet ${res.status}: ${await res.text()}`)
	return (await res.json()) as { internal_user_id: number; internal_wallet_id: number; address: string }
}

async function backfillOne(agent: Pick<typeof agents.$inferSelect, 'id' | 'uuid' | 'metadata'>): Promise<[Outcome, string]> {
	// agents.metadata may be a TEXT column in the shared DB, so it can arrive as a string.
	const raw: unknown = agent.metadata
	const md = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as Record<string, unknown>
	const address = md.wallet_address
	const subOrgId = md.wallet_sub_org_id
	if (typeof address !== 'string' || typeof subOrgId !== 'string') {
		return ['skipped', 'no wallet_address/wallet_sub_org_id']
	}

	const walletId = await findTurnkeyWalletId(subOrgId, address)
	if (!walletId) return ['skipped', `no Turnkey account ${address} in sub-org ${subOrgId}`]

	const current = `user=${md.internal_user_id ?? '-'} wallet=${md.internal_wallet_id ?? '-'}`
	if (!apply) return ['would-fix', `${address} -> turnkey ${walletId} (current ${current})`]

	const p = await provision(agent.uuid, walletId, subOrgId, address)
	if (p.address.toLowerCase() !== address.toLowerCase()) {
		return ['error', `provision returned address ${p.address}, expected ${address}`]
	}
	if (md.internal_user_id === p.internal_user_id && md.internal_wallet_id === p.internal_wallet_id) {
		return ['already-ok', current]
	}

	// Atomic merge, guarded on wallet_address so a concurrent wallet rotation wins.
	const updated = await db
		.update(agents)
		.set({
			metadata: sql`coalesce(${agents.metadata}::jsonb, '{}'::jsonb) || ${JSON.stringify({
				internal_user_id: p.internal_user_id,
				internal_wallet_id: p.internal_wallet_id,
			})}::jsonb`,
			updatedAt: new Date(),
		})
		.where(and(eq(agents.id, agent.id), sql`${agents.metadata}::jsonb->>'wallet_address' = ${address}`))
		.returning({ id: agents.id })
	if (updated.length === 0) return ['skipped', 'wallet_address changed during backfill']
	return ['fixed', `${current} -> user=${p.internal_user_id} wallet=${p.internal_wallet_id}`]
}

async function main() {
	// Only the columns we need: the shared agents table can lag drizzle's schema.
	let query = db
		.select({ id: agents.id, uuid: agents.uuid, metadata: agents.metadata })
		.from(agents)
		.where(
			onlyAgent !== undefined
				? and(eq(agents.id, onlyAgent), sql`${agents.metadata}::jsonb ? 'wallet_address'`)
				: sql`${agents.metadata}::jsonb ? 'wallet_address'`,
		)
		.orderBy(agents.id)
		.$dynamic()
	if (limit !== undefined) query = query.limit(limit)
	const rows = await query

	console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${rows.length} agent(s) with a managed wallet`)
	const counts: Record<Outcome, number> = {
		'would-fix': 0,
		fixed: 0,
		'already-ok': 0,
		skipped: 0,
		error: 0,
	}
	for (const agent of rows) {
		let outcome: Outcome
		let detail: string
		try {
			;[outcome, detail] = await backfillOne(agent)
		} catch (e) {
			;[outcome, detail] = ['error', e instanceof Error ? e.message : String(e)]
		}
		counts[outcome]++
		console.log(`agent ${agent.id} (${agent.uuid.slice(0, 8)}): ${outcome} — ${detail}`)
	}
	console.log('summary', counts)
	process.exit(counts.error > 0 ? 1 : 0)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
