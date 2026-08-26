/**
 * In-memory CLOB engine — the dev-lane twin of `suwappu-dag`'s
 * `suwappu-clob` crate (branch claude/parity-dominance-execution-c4hz5l).
 *
 * Semantics mirror the Rust engine exactly: price-time priority,
 * GTC/IOC/FOK/post-only, self-trade prevention (cancel-taker or
 * cancel-resting), fills at maker price, and multilateral netting into a
 * domain-separated SHA3-256 settlement batch root whose byte encoding is
 * identical to `SettlementBatch::batch_root` in Rust — the same order
 * stream must produce the same root in both implementations.
 *
 * State is process-local and non-durable by design: this is the venue
 * integration surface for dev; the source of truth graduates to the DAG L1
 * lane. Do not point money at it.
 */
import { createHash } from 'crypto'

export type Side = 'bid' | 'ask'
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'PostOnly'
export type SelfTradePolicy = 'CancelTaker' | 'CancelResting'
export type OrderStatus =
	| 'Filled'
	| 'PartiallyFilledResting'
	| 'Resting'
	| 'PartiallyFilledCanceled'
	| 'Canceled'

export const SETTLEMENT_DST = 'SUWAPPU-CLOB-SETTLEMENT-V1'
export const MARKET_DST = 'SUWAPPU-CLOB-MARKET-V1'
export const ACCOUNT_DST = 'SUWAPPU-CLOB-ACCOUNT-V1'

const U64_MAX = (1n << 64n) - 1n
const I128_MAX = (1n << 127n) - 1n
const I128_MIN = -(1n << 127n)

/** `H(len(tag) as u32 BE || tag || data)` — mirrors suwappu-crypto's sha3_256_domain. */
export function sha3_256Domain(tag: string, data: Uint8Array): Buffer {
	const tagBytes = Buffer.from(tag, 'ascii')
	const len = Buffer.alloc(4)
	len.writeUInt32BE(tagBytes.length)
	return createHash('sha3-256').update(len).update(tagBytes).update(data).digest()
}

/** 32-byte market id from a canonical pair symbol (e.g. "SUWP/USDC"). */
export function marketId(symbol: string): Buffer {
	return sha3_256Domain(MARKET_DST, Buffer.from(symbol, 'utf8'))
}

/** 32-byte account id from an agent id. */
export function accountId(agentId: string): Buffer {
	return sha3_256Domain(ACCOUNT_DST, Buffer.from(agentId, 'utf8'))
}

function u64be(v: bigint): Buffer {
	const b = Buffer.alloc(8)
	b.writeBigUInt64BE(v)
	return b
}

function i128be(v: bigint): Buffer {
	const u = BigInt.asUintN(128, v)
	return Buffer.from(u.toString(16).padStart(32, '0'), 'hex')
}

export interface RestingOrder {
	id: bigint
	account: string // hex account id
	qty: bigint
}

interface Level {
	price: bigint
	queue: RestingOrder[]
}

export interface Fill {
	makerOrder: bigint
	takerOrder: bigint
	makerAccount: string
	takerAccount: string
	price: bigint
	qty: bigint
	takerSide: Side
	seq: bigint
}

export interface SubmitOutcome {
	orderId: bigint
	fills: Fill[]
	canceledResting: bigint[]
	restingQty: bigint
	status: OrderStatus
}

export class ClobError extends Error {
	constructor(
		readonly code:
			| 'ZeroPriceOrQty'
			| 'UnknownOrder'
			| 'NotOrderOwner'
			| 'NotionalOverflow'
			| 'RangeExceeded',
		message: string,
	) {
		super(message)
	}
}

/** Single-market deterministic matching engine (see module doc). */
export class MatchingEngine {
	/** asks ascending by price, bids descending; FIFO queues per level. */
	private asks: Level[] = []
	private bids: Level[] = []
	private owners = new Map<string, { side: Side; price: bigint; account: string }>()
	private nextOrderId = 0n
	private nextFillSeq = 0n
	/** Open settlement window: all fills since the last window close. */
	readonly windowFills: Fill[] = []

	constructor(
		readonly symbol: string,
		readonly stp: SelfTradePolicy = 'CancelTaker',
	) {}

	get marketIdHex(): string {
		return marketId(this.symbol).toString('hex')
	}

	depth(): number {
		return this.owners.size
	}

	bestBid(): bigint | undefined {
		return this.bids[0]?.price
	}

	bestAsk(): bigint | undefined {
		return this.asks[0]?.price
	}

	/** Top-of-book snapshot, `levels` price levels per side. */
	snapshot(levels = 20) {
		const view = (side: Level[]) =>
			side.slice(0, levels).map((l) => ({
				price: l.price.toString(),
				qty: l.queue.reduce((a, o) => a + o.qty, 0n).toString(),
				orders: l.queue.length,
			}))
		return { bids: view(this.bids), asks: view(this.asks) }
	}

	submit(
		account: string,
		side: Side,
		price: bigint,
		qty: bigint,
		tif: TimeInForce,
	): SubmitOutcome {
		if (price <= 0n || qty <= 0n) throw new ClobError('ZeroPriceOrQty', 'price and qty must be positive')
		if (price > U64_MAX || qty > U64_MAX) throw new ClobError('RangeExceeded', 'price and qty must fit u64')

		const orderId = this.nextOrderId++
		const none = (status: OrderStatus): SubmitOutcome => ({
			orderId,
			fills: [],
			canceledResting: [],
			restingQty: 0n,
			status,
		})

		if (tif === 'PostOnly') {
			if (this.wouldCross(side, price)) return none('Canceled')
			this.rest(orderId, account, side, price, qty)
			return { ...none('Resting'), restingQty: qty }
		}

		if (tif === 'FOK' && this.crossableQty(side, price, account) < qty) {
			return none('Canceled')
		}

		let remaining = qty
		const fills: Fill[] = []
		const canceledResting: bigint[] = []
		let takerCanceled = false

		while (remaining > 0n) {
			const counter = this.bestCounter(side, price)
			if (!counter) break
			const { price: makerPrice, order: maker } = counter
			if (maker.account === account) {
				if (this.stp === 'CancelTaker') {
					takerCanceled = true
					break
				}
				this.remove(maker.id)
				canceledResting.push(maker.id)
				continue
			}
			const fillQty = remaining < maker.qty ? remaining : maker.qty
			this.consumeFront(side === 'bid' ? 'ask' : 'bid', makerPrice, fillQty)
			const fill: Fill = {
				makerOrder: maker.id,
				takerOrder: orderId,
				makerAccount: maker.account,
				takerAccount: account,
				price: makerPrice,
				qty: fillQty,
				takerSide: side,
				seq: this.nextFillSeq++,
			}
			fills.push(fill)
			this.windowFills.push(fill)
			remaining -= fillQty
		}

		const filledAny = fills.length > 0
		let status: OrderStatus
		let restingQty = 0n
		if (remaining === 0n) {
			status = 'Filled'
		} else if (takerCanceled) {
			status = filledAny ? 'PartiallyFilledCanceled' : 'Canceled'
		} else if (tif === 'GTC') {
			this.rest(orderId, account, side, price, remaining)
			status = filledAny ? 'PartiallyFilledResting' : 'Resting'
			restingQty = remaining
		} else {
			status = filledAny ? 'PartiallyFilledCanceled' : 'Canceled'
		}
		return { orderId, fills, canceledResting, restingQty, status }
	}

	/** Cancel a resting order; only the owner may cancel. Returns freed qty. */
	cancel(id: bigint, account: string): bigint {
		const meta = this.owners.get(id.toString())
		if (!meta) throw new ClobError('UnknownOrder', 'unknown or already-filled order')
		if (meta.account !== account) throw new ClobError('NotOrderOwner', 'order owned by another account')
		return this.remove(id)?.qty ?? 0n
	}

	/**
	 * Net the open window into per-account deltas + the batch root
	 * (byte-identical encoding to the Rust `SettlementBatch`).
	 */
	settlementWindow(): {
		deltas: Map<string, { base: bigint; quote: bigint }>
		fillCount: bigint
		firstSeq: bigint
		lastSeq: bigint
		root: string
	} {
		const deltas = new Map<string, { base: bigint; quote: bigint }>()
		const get = (a: string) => {
			let d = deltas.get(a)
			if (!d) {
				d = { base: 0n, quote: 0n }
				deltas.set(a, d)
			}
			return d
		}
		const checked = (v: bigint) => {
			if (v > I128_MAX || v < I128_MIN) throw new ClobError('NotionalOverflow', 'notional overflow')
			return v
		}
		let firstSeq = 0n
		let lastSeq = 0n
		this.windowFills.forEach((f, i) => {
			if (i === 0) firstSeq = f.seq
			lastSeq = f.seq
			const quote = checked(f.qty * f.price)
			const [buyer, seller] =
				f.takerSide === 'bid' ? [f.takerAccount, f.makerAccount] : [f.makerAccount, f.takerAccount]
			const b = get(buyer)
			b.base = checked(b.base + f.qty)
			b.quote = checked(b.quote - quote)
			const s = get(seller)
			s.base = checked(s.base - f.qty)
			s.quote = checked(s.quote + quote)
		})

		const fillCount = BigInt(this.windowFills.length)
		const accounts = [...deltas.keys()].sort() // lexicographic = BTreeMap byte order over hex
		const parts: Buffer[] = [
			marketId(this.symbol),
			u64be(fillCount),
			u64be(firstSeq),
			u64be(lastSeq),
		]
		for (const a of accounts) {
			const d = deltas.get(a)!
			parts.push(Buffer.from(a, 'hex'), i128be(d.base), i128be(d.quote))
		}
		const root = sha3_256Domain(SETTLEMENT_DST, Buffer.concat(parts)).toString('hex')
		return { deltas, fillCount, firstSeq, lastSeq, root }
	}

	/** Close the open window: return its batch, then start a fresh window. */
	closeWindow() {
		const batch = this.settlementWindow()
		this.windowFills.length = 0
		return batch
	}

	// ---- internals ------------------------------------------------------

	private sideLevels(side: Side): Level[] {
		return side === 'bid' ? this.bids : this.asks
	}

	private wouldCross(side: Side, price: bigint): boolean {
		if (side === 'bid') {
			const a = this.bestAsk()
			return a !== undefined && price >= a
		}
		const b = this.bestBid()
		return b !== undefined && price <= b
	}

	private bestCounter(takerSide: Side, limit: bigint): { price: bigint; order: RestingOrder } | undefined {
		const levels = takerSide === 'bid' ? this.asks : this.bids
		const top = levels[0]
		if (!top) return undefined
		if (takerSide === 'bid' ? top.price > limit : top.price < limit) return undefined
		const order = top.queue[0]
		return order ? { price: top.price, order } : undefined
	}

	private crossableQty(takerSide: Side, limit: bigint, exclude: string): bigint {
		const levels = takerSide === 'bid' ? this.asks : this.bids
		let total = 0n
		for (const l of levels) {
			if (takerSide === 'bid' ? l.price > limit : l.price < limit) break
			for (const o of l.queue) if (o.account !== exclude) total += o.qty
		}
		return total
	}

	private rest(id: bigint, account: string, side: Side, price: bigint, qty: bigint) {
		const levels = this.sideLevels(side)
		let idx = levels.findIndex((l) => (side === 'bid' ? l.price <= price : l.price >= price))
		if (idx === -1) idx = levels.length
		if (levels[idx]?.price === price) {
			levels[idx].queue.push({ id, account, qty })
		} else {
			levels.splice(idx, 0, { price, queue: [{ id, account, qty }] })
		}
		this.owners.set(id.toString(), { side, price, account })
	}

	private remove(id: bigint): RestingOrder | undefined {
		const meta = this.owners.get(id.toString())
		if (!meta) return undefined
		this.owners.delete(id.toString())
		const levels = this.sideLevels(meta.side)
		const idx = levels.findIndex((l) => l.price === meta.price)
		if (idx === -1) return undefined
		const pos = levels[idx].queue.findIndex((o) => o.id === id)
		if (pos === -1) return undefined
		const [order] = levels[idx].queue.splice(pos, 1)
		if (levels[idx].queue.length === 0) levels.splice(idx, 1)
		return order
	}

	private consumeFront(side: Side, price: bigint, qty: bigint) {
		const levels = this.sideLevels(side)
		const idx = levels.findIndex((l) => l.price === price)
		if (idx === -1) return
		const front = levels[idx].queue[0]
		if (!front) return
		if (front.qty > qty) {
			front.qty -= qty
			return
		}
		this.owners.delete(front.id.toString())
		levels[idx].queue.shift()
		if (levels[idx].queue.length === 0) levels.splice(idx, 1)
	}
}

/** Process-local market registry for the dev lane. */
const engines = new Map<string, MatchingEngine>()

export function getOrCreateEngine(symbol: string): MatchingEngine {
	const key = symbol.toUpperCase()
	let e = engines.get(key)
	if (!e) {
		e = new MatchingEngine(key)
		engines.set(key, e)
	}
	return e
}

export function getEngine(symbol: string): MatchingEngine | undefined {
	return engines.get(symbol.toUpperCase())
}

export function listMarkets(): { symbol: string; marketId: string; depth: number }[] {
	return [...engines.values()].map((e) => ({
		symbol: e.symbol,
		marketId: e.marketIdHex,
		depth: e.depth(),
	}))
}
