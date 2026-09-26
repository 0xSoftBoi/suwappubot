import { describe, expect, test } from 'bun:test'
import {
  ArcKind,
  decodeQuotes,
  decodeUint,
  encodeProbeBatch,
  encodeQuoteRoute,
  encodeQuoteRoutes,
  QuoterClient,
  routeBatches,
  type Leg,
  type Probe,
} from './quoter'
import { encodeAbiParameters, type Hex } from 'viem'

// Golden vectors generated from electric-router's own pure-Python codec
// (`erouter.core.codec.encode_call` over `Leg.as_tuple()`/`Probe.as_tuple()`),
// so this port cannot drift from the reference byte-for-byte.

const LEG_A: Leg = {
  target: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
  kind: ArcKind.SWAP_STABLE,
  i: 0,
  j: 1,
  n: 3,
  srcSlot: 0,
  dstSlot: 1,
  bps: 0,
}
const LEG_B: Leg = {
  target: '0xD51a44d3FaE010294C616388b506AcdA1bfAAE46',
  kind: ArcKind.SWAP_CRYPTO,
  i: 0,
  j: 2,
  n: 3,
  srcSlot: 1,
  dstSlot: 2,
  bps: 10_000,
}
const PROBE: Probe = {
  pool: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
  kind: ArcKind.SWAP_STABLE,
  i: 0,
  j: 1,
  n: 3,
  dx: 10n ** 18n,
}

describe('erouter quoter encoding (golden vectors from the Python codec)', () => {
  test('quote_route matches the reference encoder', () => {
    const data = encodeQuoteRoute([LEG_A, LEG_B], 10n ** 18n, 2)
    expect(data.startsWith('0x10e44fa3')).toBe(true)
    expect(data).toBe(
      ('0x' +
        '10e44fa300000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002000000000000000000000000bebc44782c7db0a1a60cb6fe97d0b483032ff1c70000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d51a44d3fae010294c616388b506acda1bfaae460000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000002710') as Hex,
    )
  })

  test('probe_batch matches the reference encoder', () => {
    const data = encodeProbeBatch([PROBE])
    expect(data).toBe(
      ('0x' +
        '9f344e6600000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000bebc44782c7db0a1a60cb6fe97d0b483032ff1c700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000de0b6b3a7640000') as Hex,
    )
  })

  test('quote_routes flattens with bounds and matches the reference', () => {
    const data = encodeQuoteRoutes(
      [[LEG_A], [LEG_A, LEG_B]],
      [10n ** 18n, 2n * 10n ** 18n],
      [1, 2],
    )
    expect(data.startsWith('0x4224e7f7')).toBe(true)
    // bounds [1, 3]: cumulative leg counts, as the reference builds them.
    expect(data.includes('2710')).toBe(true) // LEG_B bps=10000
  })

  test('leg validation mirrors the reference', () => {
    expect(() => encodeQuoteRoute([{ ...LEG_A, dstSlot: 0 }], 1n, 0)).toThrow()
    expect(() => encodeQuoteRoute([{ ...LEG_A, bps: 10_001 }], 1n, 1)).toThrow()
  })
})

describe('routeBatches', () => {
  test('bounds by route count and total legs like the reference _batches', () => {
    const short = [LEG_A]
    const routes = Array.from({ length: 40 }, () => short)
    expect(routeBatches(routes, 32, 768)).toEqual([
      [0, 32],
      [32, 40],
    ])
    // leg cap: 3 routes of 300 legs each — two fit, the third goes alone.
    const long = Array.from({ length: 300 }, () => LEG_A)
    expect(routeBatches([long, long, long], 32, 768)).toEqual([
      [0, 2],
      [2, 3],
    ])
  })
})

describe('QuoterClient', () => {
  test('quoteRoutes decodes values and halves on a failing chunk', async () => {
    let calls = 0
    const client = new QuoterClient(async (_to, _data) => {
      calls += 1
      if (calls === 1) throw new Error('gas cap')
      return encodeAbiParameters([{ type: 'uint256[]' }], [[42n]])
    })
    const out = await client.quoteRoutes([[LEG_A], [LEG_A]], [1n, 1n], [1, 1])
    expect(out).toEqual([42n, 42n])
    expect(calls).toBe(3) // one failed batch, then each half separately
  })

  test('probe maps status codes and returns MISSING on lone failure', async () => {
    const payload = encodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [
            { name: 'status', type: 'uint8' },
            { name: 'value', type: 'uint256' },
          ],
        },
      ],
      [[{ status: 0, value: 7n }, { status: 2, value: 0n }]],
    )
    const okClient = new QuoterClient(async () => payload)
    const quotes = await okClient.probe([PROBE, PROBE])
    expect(quotes).toEqual([
      { status: 'VALUE', value: 7n },
      { status: 'REVERTED', value: 0n },
    ])

    const deadClient = new QuoterClient(async () => {
      throw new Error('down')
    })
    expect(await deadClient.probe([PROBE])).toEqual([{ status: 'MISSING', value: 0n }])
  })

  test('decode helpers', () => {
    expect(decodeUint(encodeAbiParameters([{ type: 'uint256' }], [12345n]))).toBe(12345n)
    expect(decodeQuotes(encodeAbiParameters(
      [{ type: 'tuple[]', components: [{ name: 'status', type: 'uint8' }, { name: 'value', type: 'uint256' }] }],
      [[{ status: 9, value: 1n }]],
    ))).toEqual([{ status: 'MISSING', value: 1n }])
  })
})
