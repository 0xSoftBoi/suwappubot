/**
 * M12 payments-chain fee model. Live RPC fee data per chain, expressed in the stablecoin itself.
 * Tempo (chain 4217, no native gas token; fees paid in a USD TIP-20) is supported here without
 * editing chain.ts: its RPC is resolved in chainRpc.ts.
 *
 * Assumptions (flagged in the response `assumptions`): gas units per ERC-20 transfer are static
 * estimates (no funded sender to eth_estimateGas against); L2 L1-data fees are not included;
 * Tempo eth_gasPrice is read as attodollars (1e-18 USD) per gas — UNVERIFIED against Tempo docs.
 */
import { Context, Effect, Layer } from 'effect'
import { decodeAbiParameters } from 'viem'
import { fetchTokenPrices } from '../../lib/prices'
import { type BankAsset, BANK_ASSETS, findAsset } from './assets'
import { TEMPO_CHAIN_ID, jsonRpc, rpcUrlFor } from './chainRpc'
import { type BankError, bankErr } from './errors'

/** Tempo pathUSD (USD TIP-20, 6 decimals) — address from docs/plans/neobank-provider-apis.md; decimals()/symbol() are re-read live. */
export const TEMPO_PATHUSD = '0x20c0000000000000000000000000000000000000'

const GAS_UNITS: Record<string, number> = { ethereum: 65_000, base: 65_000, polygon: 65_000, arbitrum: 90_000, optimism: 65_000, tempo: 70_000 }
const CONFIRMATIONS: Record<string, number> = { ethereum: 3 }
const NATIVE: Record<string, string> = { ethereum: 'ETH', base: 'ETH', arbitrum: 'ETH', optimism: 'ETH', polygon: 'MATIC' }

export interface ChainFee {
	chain: string
	asset: string
	feeToken: string | null
	gasUnits: number
	gasPrice: string
	/** Estimated fee in the stablecoin's minor units (null when it cannot be expressed in-asset). */
	feeMinor: string | null
	feeUsdMicros: string | null
	confirmations: number
	avgBlockTimeMs: number | null
	estConfirmSeconds: number | null
	feeError?: string
	notes: string[]
}

export interface FeeModel {
	asset: string
	amountMinor: string
	chains: ChainFee[]
	recommended: { chain: string; reason: string } | null
	assumptions: string[]
	fetchedAt: string
}

const hexBig = (h: string) => BigInt(h)
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b

async function blockTimeMs(url: string): Promise<number | null> {
	try {
		const latest = await jsonRpc<{ number: string; timestamp: string; timestampMillisPart?: string }>(url, 'eth_getBlockByNumber', ['latest', false])
		const n = hexBig(latest.number)
		const back = n > 50n ? 50n : n
		if (back === 0n) return null
		const old = await jsonRpc<{ timestamp: string; timestampMillisPart?: string }>(url, 'eth_getBlockByNumber', [`0x${(n - back).toString(16)}`, false])
		const t = (b: { timestamp: string; timestampMillisPart?: string }) => Number(hexBig(b.timestamp)) * 1000 + (b.timestampMillisPart ? Number(hexBig(b.timestampMillisPart)) : 0)
		return Math.max(1, Math.round((t(latest) - t(old)) / Number(back)))
	} catch {
		return null
	}
}

async function readTokenMeta(chain: string, token: string): Promise<{ symbol: string; decimals: number }> {
	const url = rpcUrlFor(chain)
	const sym = await jsonRpc<string>(url, 'eth_call', [{ to: token, data: '0x95d89b41' }, 'latest'])
	const dec = await jsonRpc<string>(url, 'eth_call', [{ to: token, data: '0x313ce567' }, 'latest'])
	return { symbol: decodeAbiParameters([{ type: 'string' }], sym as `0x${string}`)[0], decimals: Number(hexBig(dec)) }
}

async function feeFor(chain: string, asset: BankAsset | null, usdPriced: Record<string, bigint | null>): Promise<ChainFee> {
	const notes: string[] = []
	const gasUnits = GAS_UNITS[chain] ?? 65_000
	const conf = CONFIRMATIONS[chain] ?? 1
	const base: ChainFee = { chain, asset: asset?.symbol ?? 'pathUSD', feeToken: null, gasUnits, gasPrice: '0', feeMinor: null, feeUsdMicros: null, confirmations: conf, avgBlockTimeMs: null, estConfirmSeconds: null, notes }
	try {
		const url = rpcUrlFor(chain)
		const [gp, bt] = await Promise.all([jsonRpc<string>(url, 'eth_gasPrice', []), blockTimeMs(url)])
		const gasPrice = hexBig(gp)
		base.gasPrice = gasPrice.toString()
		base.avgBlockTimeMs = bt
		base.estConfirmSeconds = bt === null ? null : Math.ceil((bt * conf) / 1000)
		if (chain === 'tempo') {
			const meta = await readTokenMeta('tempo', TEMPO_PATHUSD)
			base.feeToken = `${meta.symbol} (${TEMPO_PATHUSD}, ${meta.decimals} decimals, read on-chain)`
			// attodollars (1e-18 USD) per gas -> USD micro-units: gas*price/1e12
			const micros = ceilDiv(BigInt(gasUnits) * gasPrice, 10n ** 12n)
			base.feeUsdMicros = micros.toString()
			base.feeMinor = meta.decimals === 6 ? micros.toString() : null
			notes.push('stablecoin gas: fee is paid in a USD TIP-20 via feeToken, no native token needed', 'gas price unit read as attodollars/gas (UNVERIFIED)')
			return base
		}
		const sym = NATIVE[chain]
		const px = sym ? usdPriced[sym] : null
		if (!px) {
			base.feeError = `no USD price for native gas token ${sym ?? '(unknown)'}`
			return base
		}
		const micros = ceilDiv(BigInt(gasUnits) * gasPrice * px, 10n ** 18n)
		base.feeUsdMicros = micros.toString()
		base.feeToken = sym ?? null
		if (asset?.currency === 'USD' && asset.decimals === 6) base.feeMinor = micros.toString()
		else notes.push(`fee not expressible in ${asset?.symbol ?? 'asset'} without an FX rate; see feeUsdMicros`)
		if (['base', 'arbitrum', 'optimism'].includes(chain)) notes.push('excludes L1 data fee')
		notes.push(`gas paid in native ${sym} (user must hold gas)`)
		return base
	} catch (e) {
		base.feeError = e instanceof Error ? e.message : String(e)
		return base
	}
}

export interface BankPaymentsChainServiceInterface {
	readonly feeModel: (i: { asset: string; amountMinor: string; chains: string[] }) => Effect.Effect<FeeModel, BankError>
}
export class BankPaymentsChainService extends Context.Tag('BankPaymentsChainService')<BankPaymentsChainService, BankPaymentsChainServiceInterface>() {}

export const feeModel = (i: { asset: string; amountMinor: string; chains: string[] }): Effect.Effect<FeeModel, BankError> =>
	Effect.gen(function* () {
		if (!/^[1-9][0-9]{0,77}$/.test(i.amountMinor)) return yield* Effect.fail(bankErr('VALIDATION', 'amountMinor must be a positive integer string'))
		const chains = [...new Set(i.chains.map((c) => c.toLowerCase()))]
		if (!chains.length) return yield* Effect.fail(bankErr('VALIDATION', 'chains must list at least one chain available on both sides'))
		const sym = i.asset.toUpperCase()
		const candidates = chains.filter((c) => (c === 'tempo' ? sym === 'USD' || sym === 'PATHUSD' || sym === 'USDC' : !!findAsset(sym, c)))
		if (!candidates.length) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `${sym} is not supported on any of: ${chains.join(', ')}`))
		const prices = yield* Effect.tryPromise({ try: () => fetchTokenPrices(['ETH', 'MATIC']), catch: () => bankErr('UPSTREAM', 'price feed unavailable') }).pipe(Effect.orElseSucceed(() => ({}) as Record<string, { usd: number }>))
		const priced: Record<string, bigint | null> = {}
		for (const s of ['ETH', 'MATIC']) {
			const p = (prices as Record<string, { usd: number } | undefined>)[s]?.usd
			priced[s] = p && p > 0 ? BigInt(Math.round(p * 1e6)) : null
		}
		const fees = yield* Effect.promise(() => Promise.all(candidates.map((c) => feeFor(c, c === 'tempo' ? null : (findAsset(sym, c) ?? null), priced))))
		const ok = fees.filter((f) => !f.feeError && f.feeUsdMicros !== null)
		ok.sort((a, b) => {
			const d = BigInt(a.feeUsdMicros!) - BigInt(b.feeUsdMicros!)
			return d !== 0n ? (d < 0n ? -1 : 1) : (a.estConfirmSeconds ?? 1e9) - (b.estConfirmSeconds ?? 1e9)
		})
		const best = ok[0]
		return {
			asset: sym,
			amountMinor: i.amountMinor,
			chains: fees,
			recommended: best ? { chain: best.chain, reason: `lowest estimated fee (${best.feeUsdMicros} USD micro-units)${best.estConfirmSeconds !== null ? `, ~${best.estConfirmSeconds}s to confirm` : ''}` } : null,
			assumptions: ['gas units per transfer are static estimates', 'L2 L1-data fees excluded', 'Tempo gas price unit (attodollars/gas) UNVERIFIED', `Tempo chain id ${TEMPO_CHAIN_ID}; pathUSD is a USD stablecoin distinct from USDC`],
			fetchedAt: new Date().toISOString(),
		}
	})

export const BankPaymentsChainServiceLive = Layer.succeed(BankPaymentsChainService, { feeModel })
export { BANK_ASSETS }
