import type { Address } from 'viem'
import { aprOf } from './shared'
import type { Edge } from './useNetwork'

/**
 * Client-side clearing solver: greedy cycle cancelling on the live credit graph.
 *
 * A simplified cousin of the min-cost-flow MTCS used by Cycles: enumerate
 * simple debt cycles (bounded length), repeatedly take the one removing the most
 * gross debt, subtract it, and search the residual graph again. Every cycle is a
 * circulation, so the concatenated edge list is itself a valid clear() argument
 * (the contract applies edges sequentially against live owed amounts and checks
 * per-node conservation). The contract — not this code — is the safety boundary:
 * a wrong plan can only revert.
 */

export type Cycle = { nodes: Address[]; amount: bigint }

export type ClearingPlan = {
  cycles: Cycle[]
  edges: { debtor: Address; creditor: Address; amount: bigint }[]
  grossRemoved: bigint
  /** Interest (per year, token units) the network stops accruing. */
  networkInterestSavedPerYear: number
  /** For `me`: interest you stop paying minus interest you stop earning, per year. */
  myInterestEffectPerYear: number
}

const key = (d: Address, c: Address) => `${d.toLowerCase()}>${c.toLowerCase()}`

function adjacency(residual: Map<string, { e: Edge; amount: bigint }>) {
  const adj = new Map<string, { to: Address; k: string }[]>()
  for (const [k, { e, amount }] of residual) {
    if (amount <= 0n) continue
    const from = e.debtor.toLowerCase()
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from)!.push({ to: e.creditor, k })
  }
  return adj
}

/** Simple cycles of length 3..maxLen. `through` restricts to cycles containing it. */
export function findCycles(
  residual: Map<string, { e: Edge; amount: bigint }>,
  opts: { through?: Address; maxLen?: number; limit?: number } = {},
): Cycle[] {
  const maxLen = opts.maxLen ?? 6
  const limit = opts.limit ?? 200
  const adj = adjacency(residual)
  const starts = opts.through ? [opts.through.toLowerCase()] : [...adj.keys()].sort()
  const out: Cycle[] = []
  const seenCanon = new Set<string>()

  for (const start of starts) {
    const path: Address[] = []
    const onPath = new Set<string>()
    const dfs = (node: string, orig: Address) => {
      if (out.length >= limit) return
      path.push(orig)
      onPath.add(node)
      for (const { to, k } of adj.get(node) ?? []) {
        const t = to.toLowerCase()
        if (t === start && path.length >= 3) {
          // Canonical form = rotation starting at the smallest address → dedupe.
          const lower = path.map((p) => p.toLowerCase())
          const minIdx = lower.indexOf([...lower].sort()[0])
          const canon = [...lower.slice(minIdx), ...lower.slice(0, minIdx)].join(',')
          if (!seenCanon.has(canon)) {
            seenCanon.add(canon)
            const nodes = [...path]
            let amount = residual.get(k)!.amount
            for (let i = 0; i < nodes.length - 1; i++) {
              const a = residual.get(key(nodes[i], nodes[i + 1]))!.amount
              if (a < amount) amount = a
            }
            out.push({ nodes, amount })
          }
          continue
        }
        // Network-wide: only extend through nodes "after" start to avoid re-finding rotations.
        if (!opts.through && t < start) continue
        if (onPath.has(t) || path.length >= maxLen) continue
        dfs(t, to)
      }
      path.pop()
      onPath.delete(node)
    }
    const startOrig = opts.through ?? (residual.size ? [...residual.values()].find((r) => r.e.debtor.toLowerCase() === start)?.e.debtor : undefined)
    if (startOrig) dfs(start, startOrig)
  }
  return out.filter((c) => c.amount > 0n)
}

export function planClearing(edges: Edge[], opts: { through?: Address; me?: Address; maxCycles?: number } = {}): ClearingPlan {
  const residual = new Map<string, { e: Edge; amount: bigint }>()
  for (const e of edges) residual.set(key(e.debtor, e.creditor), { e, amount: e.amount })

  const cycles: Cycle[] = []
  const planEdges: ClearingPlan['edges'] = []
  let gross = 0n
  let networkInterest = 0
  let myEffect = 0
  const me = opts.me?.toLowerCase()

  for (let iter = 0; iter < (opts.maxCycles ?? 12); iter++) {
    const found = findCycles(residual, { through: opts.through })
    if (found.length === 0) break
    // Greedy: maximise gross debt removed (amount × legs).
    found.sort((x, y) => {
      const gx = x.amount * BigInt(x.nodes.length)
      const gy = y.amount * BigInt(y.nodes.length)
      return gy > gx ? 1 : gy < gx ? -1 : 0
    })
    const best = found[0]
    cycles.push(best)
    for (let i = 0; i < best.nodes.length; i++) {
      const d = best.nodes[i]
      const c = best.nodes[(i + 1) % best.nodes.length]
      const r = residual.get(key(d, c))!
      r.amount -= best.amount
      planEdges.push({ debtor: d, creditor: c, amount: best.amount })
      const yearly = (Number(best.amount) / 1e18) * aprOf(r.e.feeRate)
      networkInterest += yearly
      if (me && d.toLowerCase() === me) myEffect += yearly // stop paying
      if (me && c.toLowerCase() === me) myEffect -= yearly // stop earning
    }
    gross += best.amount * BigInt(best.nodes.length)
  }

  return {
    cycles,
    edges: planEdges,
    grossRemoved: gross,
    networkInterestSavedPerYear: networkInterest,
    myInterestEffectPerYear: myEffect,
  }
}
