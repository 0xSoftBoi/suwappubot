import { Effect } from 'effect'
import { z } from 'zod'
import { findAsset, toMinor } from '../../services/bank/assets'
import { BankPaymentsChainService } from '../../services/bank/BankPaymentsChainService'
import { BankPrivacyService } from '../../services/bank/BankPrivacyService'
import { bankErr } from '../../services/bank/errors'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const Fee = z.object({ asset: z.string().min(2).max(16), amountMinor: z.string().regex(/^[1-9][0-9]{0,77}$/).optional(), amount: z.string().regex(/^\d+(\.\d+)?$/).optional(), chains: z.array(z.string().min(2).max(32)).min(1).max(12) })
const Payout = z.object({ payeeMetaAddress: z.string().min(60).max(160), payoutRef: z.string().min(1).max(128), token: z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), amountMinor: z.string().regex(/^[1-9][0-9]{0,77}$/) }).optional() })
const Scan = z.object({ chain: z.string().min(2).max(32), fromBlock: z.string().regex(/^0x[0-9a-fA-F]+$/), toBlock: z.string().optional(), viewPrivateKey: hex32, spendPublicKey: z.string().regex(/^0x[0-9a-fA-F]{66}$/) })
const Announced = z.object({ payoutRef: z.string().max(128), txHash: z.string().max(128), chain: z.string().max(32) })

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps
	const bad = (c: Parameters<typeof run>[0], e: z.ZodError) => c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(e) }, 400)

	app.post('/chains/fee-model', async (c) => {
		await resolveOwner(c) // authenticated callers only: this fans out chain RPC calls
		const p = Fee.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		const b = p.data
		return run(c, Effect.gen(function* () {
			let amountMinor = b.amountMinor
			if (!amountMinor) {
				if (!b.amount) return yield* Effect.fail(bankErr('VALIDATION', 'provide amountMinor or amount'))
				const a = b.chains.map((ch) => findAsset(b.asset, ch)).find(Boolean)
				if (!a) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Unsupported asset; pass amountMinor for Tempo-only requests'))
				amountMinor = yield* Effect.try({ try: () => toMinor(b.amount!, a.decimals).toString(), catch: (e) => bankErr('VALIDATION', (e as Error).message) })
			}
			return { model: yield* (yield* BankPaymentsChainService).feeModel({ asset: b.asset, amountMinor, chains: b.chains }) }
		}))
	})

	app.post('/privacy/meta-address', async (c) => {
		await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { keys: yield* (yield* BankPrivacyService).generateMetaAddress(), warning: 'Private keys are returned once and never stored. Register the meta-address with the ERC-6538 calldata.' } }))
	})
	app.post('/privacy/payout-address', async (c) => {
		const owner = await resolveOwner(c)
		const p = Payout.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return { payout: yield* (yield* BankPrivacyService).privatePayoutAddress(owner, p.data.payeeMetaAddress, p.data.payoutRef, p.data.token) } }))
	})
	app.post('/privacy/announced', async (c) => {
		const owner = await resolveOwner(c)
		const p = Announced.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* BankPrivacyService).recordAnnouncement(owner, p.data.payoutRef, p.data.txHash, p.data.chain) }))
	})
	app.post('/privacy/scan', async (c) => {
		await resolveOwner(c)
		const p = Scan.safeParse(await readJson(c))
		if (!p.success) return bad(c, p.error)
		return run(c, Effect.gen(function* () { return yield* (yield* BankPrivacyService).scan(p.data as never) }))
	})
	// Client-side scanning: raw announcements, no key material leaves the device. `fromBlock` is a hex block number; range is capped at 10,000 blocks (wider => VALIDATION).
	app.get('/privacy/announcements', async (c) => {
		await resolveOwner(c)
		const q = z.object({ chain: z.string().min(2).max(32), fromBlock: z.string().regex(/^0x[0-9a-fA-F]+$|^earliest$/), toBlock: z.string().regex(/^0x[0-9a-fA-F]+$|^latest$/).optional(), cursor: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }).safeParse(c.req.query())
		if (!q.success) return bad(c, q.error)
		return run(c, Effect.gen(function* () { return yield* (yield* BankPrivacyService).announcements(q.data as never) }))
	})
	app.get('/privacy/compliance-export', async (c) => {
		const owner = await resolveOwner(c)
		return run(c, Effect.gen(function* () { return { export: yield* (yield* BankPrivacyService).complianceExport(owner) } }))
	})
}
