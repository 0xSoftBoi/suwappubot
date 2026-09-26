// TypeScript port of electric-router's `core/quoter.py` — client side of
// RouteQuoter.vy: build calldata, decode results. See
// `flet-curve/vendor/electric-router/src/erouter/core/quoter.py` for the
// reference implementation; the unit tests hold byte-identical golden vectors
// generated from its pure-Python codec, so the two cannot drift silently.
//
// No I/O of its own — it takes an `EthCall` (one eth_call against `to` with
// `data`) and nothing else, so the same code runs against a wagmi/viem public
// client, a wallet provider, or a test double.

import { decodeAbiParameters, encodeFunctionData, type Hex } from 'viem'

// Deployed through the canonical CREATE2 proxy, so the address is a function
// of the initcode — the SAME address on every supported chain.
export const QUOTER_ADDRESS = '0x9a32418b9fd744efd6820577037529d5ba9de679' as const

// Mirrors the contract's constants (quoter.py reads them back in its tests).
export const MAX_PROBES = 600
export const MAX_ROUTES = 32
export const MAX_ALL_LEGS = 768

// Wire format — must match `contracts/RouteQuoter.vy` exactly (types.py).
export enum ArcKind {
  SWAP_STABLE = 0,
  SWAP_CRYPTO = 1,
  DEPOSIT_FIXED = 2,
  DEPOSIT_DYN = 3,
  DEPOSIT_FIXED_NOFLAG = 4,
  WITHDRAW_STABLE = 5,
  WITHDRAW_CRYPTO = 6,
  ERC4626_DEPOSIT = 7,
  ERC4626_REDEEM = 8,
  WRAP_NATIVE = 9,
  UNWRAP_NATIVE = 10,
  WSTETH_UNWRAP = 11,
  WSTETH_WRAP = 12,
  STAKE_NATIVE = 13,
  // 14 deliberately absent upstream (abandoned SWAP_UNDERLYING).
  LEND_MINT = 15,
  LEND_REDEEM = 16,
}

export interface Probe {
  pool: Hex
  kind: ArcKind
  i: number
  j: number
  n: number
  dx: bigint
}

// One executable step of a route. `bps` is a fraction of the current balance
// at `srcSlot` (0 = "take whatever is left").
export interface Leg {
  target: Hex
  kind: ArcKind
  i: number
  j: number
  n: number
  srcSlot: number
  dstSlot: number
  bps: number
}

export type QuoteStatus = 'VALUE' | 'WRONG_ABI' | 'REVERTED' | 'MISSING'

export interface Quote {
  status: QuoteStatus
  value: bigint
}

const STATUS_BY_CODE: Record<number, QuoteStatus> = {
  0: 'VALUE',
  1: 'WRONG_ABI',
  2: 'REVERTED',
}

const MISSING: Quote = { status: 'MISSING', value: 0n }

// One eth_call: run `data` against `to`, return the raw return data.
export type EthCall = (to: Hex, data: Hex) => Promise<Hex>

// ---- ABI fragments (hand-built from quoter.py's signatures) ----

const LEG_COMPONENTS = [
  { name: 'target', type: 'address' },
  { name: 'kind', type: 'uint8' },
  { name: 'i', type: 'uint8' },
  { name: 'j', type: 'uint8' },
  { name: 'n', type: 'uint8' },
  { name: 'src_slot', type: 'uint8' },
  { name: 'dst_slot', type: 'uint8' },
  { name: 'bps', type: 'uint16' },
] as const

const PROBE_COMPONENTS = [
  { name: 'pool', type: 'address' },
  { name: 'kind', type: 'uint8' },
  { name: 'i', type: 'uint8' },
  { name: 'j', type: 'uint8' },
  { name: 'n', type: 'uint8' },
  { name: 'dx', type: 'uint256' },
] as const

const ABI = [
  {
    type: 'function',
    name: 'quote_route',
    stateMutability: 'view',
    inputs: [
      { name: 'legs', type: 'tuple[]', components: LEG_COMPONENTS },
      { name: 'amount_in', type: 'uint256' },
      { name: 'dst_slot', type: 'uint8' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quote_routes',
    stateMutability: 'view',
    inputs: [
      { name: 'legs', type: 'tuple[]', components: LEG_COMPONENTS },
      { name: 'bounds', type: 'uint16[]' },
      { name: 'amounts_in', type: 'uint256[]' },
      { name: 'dst_slots', type: 'uint8[]' },
    ],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'probe_batch',
    stateMutability: 'view',
    inputs: [{ name: 'probes', type: 'tuple[]', components: PROBE_COMPONENTS }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'status', type: 'uint8' },
          { name: 'value', type: 'uint256' },
        ],
      },
    ],
  },
] as const

function legTuple(leg: Leg) {
  if (leg.srcSlot === leg.dstSlot) throw new Error(`leg must move between slots (got ${leg.srcSlot})`)
  if (leg.bps < 0 || leg.bps > 10_000) throw new Error(`bps out of range: ${leg.bps}`)
  return {
    target: leg.target,
    kind: leg.kind,
    i: leg.i,
    j: leg.j,
    n: leg.n,
    src_slot: leg.srcSlot,
    dst_slot: leg.dstSlot,
    bps: leg.bps,
  }
}

function probeTuple(probe: Probe) {
  return { pool: probe.pool, kind: probe.kind, i: probe.i, j: probe.j, n: probe.n, dx: probe.dx }
}

// ---- pure encoders/decoders (unit-tested against the Python codec) ----

export function encodeQuoteRoute(legs: Leg[], amountIn: bigint, dstSlot: number): Hex {
  return encodeFunctionData({
    abi: ABI,
    functionName: 'quote_route',
    args: [legs.map(legTuple), amountIn, dstSlot],
  })
}

export function encodeQuoteRoutes(routes: Leg[][], amountsIn: bigint[], dstSlots: number[]): Hex {
  const flat = routes.flat().map(legTuple)
  const bounds: number[] = []
  let n = 0
  for (const route of routes) {
    n += route.length
    bounds.push(n)
  }
  return encodeFunctionData({
    abi: ABI,
    functionName: 'quote_routes',
    args: [flat, bounds, amountsIn, dstSlots],
  })
}

export function encodeProbeBatch(probes: Probe[]): Hex {
  return encodeFunctionData({ abi: ABI, functionName: 'probe_batch', args: [probes.map(probeTuple)] })
}

export function decodeUint(raw: Hex): bigint {
  return decodeAbiParameters([{ type: 'uint256' }], raw)[0]
}

export function decodeUintArray(raw: Hex): bigint[] {
  return [...decodeAbiParameters([{ type: 'uint256[]' }], raw)[0]]
}

export function decodeQuotes(raw: Hex): Quote[] {
  const rows = decodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'status', type: 'uint8' },
          { name: 'value', type: 'uint256' },
        ],
      },
    ],
    raw,
  )[0]
  return rows.map((r) => ({ status: STATUS_BY_CODE[Number(r.status)] ?? 'MISSING', value: r.value }))
}

// Yield [lo, hi) route ranges bounded by both count and total legs — the
// reference `_batches` exactly.
export function routeBatches(routes: Leg[][], maxRoutes = MAX_ROUTES, maxLegs = MAX_ALL_LEGS): [number, number][] {
  const out: [number, number][] = []
  let lo = 0
  while (lo < routes.length) {
    let hi = lo
    let legs = 0
    while (hi < routes.length && hi - lo < maxRoutes) {
      const n = routes[hi].length
      if (legs + n > maxLegs && hi > lo) break
      legs += n
      hi += 1
    }
    if (hi === lo) hi = lo + 1 // a single route longer than maxLegs; alone
    out.push([lo, hi])
    lo = hi
  }
  return out
}

// ---- the client ----

export class QuoterClient {
  constructor(
    private readonly call: EthCall,
    readonly address: Hex = QUOTER_ADDRESS,
  ) {}

  async quoteRoute(legs: Leg[], amountIn: bigint, dstSlot: number): Promise<bigint> {
    const raw = await this.call(this.address, encodeQuoteRoute(legs, amountIn, dstSlot))
    return decodeUint(raw)
  }

  // All candidates in one call; 0 means the candidate is unroutable. Chunked
  // by the contract's route/leg limits, with the reference's halving fallback
  // so one oversized batch or gas-capped node does not lose the rest.
  async quoteRoutes(routes: Leg[][], amountsIn: bigint[], dstSlots: number[]): Promise<bigint[]> {
    if (routes.length !== amountsIn.length || routes.length !== dstSlots.length) {
      throw new Error('routes, amountsIn and dstSlots must be the same length')
    }
    const out: bigint[] = []
    for (const [lo, hi] of routeBatches(routes)) {
      out.push(...(await this.routesChunk(routes.slice(lo, hi), amountsIn.slice(lo, hi), dstSlots.slice(lo, hi))))
    }
    return out
  }

  private async routesChunk(routes: Leg[][], amountsIn: bigint[], dstSlots: number[]): Promise<bigint[]> {
    if (routes.length === 0) return []
    try {
      const raw = await this.call(this.address, encodeQuoteRoutes(routes, amountsIn, dstSlots))
      const decoded = decodeUintArray(raw)
      if (decoded.length !== routes.length) return routes.map(() => 0n)
      return decoded
    } catch {
      if (routes.length === 1) return [0n]
      const mid = Math.floor(routes.length / 2)
      return [
        ...(await this.routesChunk(routes.slice(0, mid), amountsIn.slice(0, mid), dstSlots.slice(0, mid))),
        ...(await this.routesChunk(routes.slice(mid), amountsIn.slice(mid), dstSlots.slice(mid))),
      ]
    }
  }

  // Quote many independent (pool, direction, size) points, chunked to the
  // contract's MAX_PROBES, halving on failure per the reference.
  async probe(probes: Probe[]): Promise<Quote[]> {
    const out: Quote[] = []
    for (let lo = 0; lo < probes.length; lo += MAX_PROBES) {
      out.push(...(await this.probeChunk(probes.slice(lo, lo + MAX_PROBES))))
    }
    return out
  }

  private async probeChunk(probes: Probe[]): Promise<Quote[]> {
    if (probes.length === 0) return []
    try {
      const raw = await this.call(this.address, encodeProbeBatch(probes))
      const decoded = decodeQuotes(raw)
      if (decoded.length !== probes.length) return probes.map(() => MISSING)
      return decoded
    } catch {
      if (probes.length === 1) return [MISSING]
      const mid = Math.floor(probes.length / 2)
      return [...(await this.probeChunk(probes.slice(0, mid))), ...(await this.probeChunk(probes.slice(mid)))]
    }
  }
}
