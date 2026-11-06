// Decides WHAT to push. Pure bigint fixed-point; no floats in the price path.
export interface QuoteParams {
  stepSafetyBps: number; // fraction of the oracle's maxStepBps we allow ourselves, in bps (8000 = 80%)
  minMoveBps: number;
  heartbeatMs: number;
  requoteEveryBlock: boolean;
  maxAnchorDevBps: number; // pool's maxAnchorDevBps
  anchorSafetyBps: number; // fraction of it we allow ourselves (8000 = 80%)
}

export interface QuoteInput {
  fair: bigint; // aggregated fair mid, 1e18
  /** oracle price at END of head == START of the target block (the on-chain step reference) */
  ref: bigint;
  maxStepBps: number;
  targetBlock: bigint;
  now: number;
  last: { block: bigint; price: bigint; at: number } | null;
}

export type QuoteDecision =
  | { action: "push"; price: bigint; clamped: boolean }
  | { action: "skip"; reason: string }
  | { action: "halt"; reason: string };

const BPS = 10_000n;

export function decideQuote(p: QuoteParams, i: QuoteInput): QuoteDecision {
  if (i.fair <= 0n || i.ref <= 0n) return { action: "halt", reason: "non-positive price" };
  if (i.maxStepBps <= 0) return { action: "halt", reason: "oracle maxStepBps unknown" };

  // allowed |p - ref| = ref * maxStepBps * safety  (strictly inside the on-chain bound: floor, then -1 wei)
  const maxDiff = (i.ref * BigInt(i.maxStepBps) * BigInt(p.stepSafetyBps)) / (BPS * BPS);
  if (maxDiff <= 1n) return { action: "halt", reason: "step bound rounds to zero" };
  const lo = i.ref - maxDiff + 1n;
  const hi = i.ref + maxDiff - 1n;
  let price = i.fair;
  let clamped = false;
  if (price > hi) {
    price = hi;
    clamped = true;
  } else if (price < lo) {
    price = lo;
    clamped = true;
  }
  if (price <= 0n) return { action: "halt", reason: "clamped price non-positive" };

  // The pool reverts if |oracle/anchor - 1| > maxAnchorDevBps. If we (post-clamp) trail fair by more
  // than our share of that band, the pool would reject us anyway -> refuse and halt (needs owner reseed).
  const dev = price > i.fair ? price - i.fair : i.fair - price;
  const bandX1e8 = BigInt(Math.round(p.maxAnchorDevBps * 10_000)) * BigInt(p.anchorSafetyBps); // bps*1e4 * bps
  if (dev * BPS * BPS * 10_000n > i.fair * bandX1e8) {
    return { action: "halt", reason: "pushed price outside anchor band assumption vs fair" };
  }

  const ref = i.last && i.last.block === i.targetBlock ? i.last.price : i.ref;
  const move = price > ref ? price - ref : ref - price;
  const moved = move * BPS * 1000n >= ref * BigInt(Math.round(p.minMoveBps * 1000));
  const hbDue = !i.last || i.now - i.last.at >= p.heartbeatMs;
  const newBlockDue = p.requoteEveryBlock && (!i.last || i.last.block !== i.targetBlock);
  if (!moved && !hbDue && !newBlockDue) return { action: "skip", reason: "below threshold, heartbeat not due" };
  if (i.last && i.last.block === i.targetBlock && i.last.price === price) {
    if (!hbDue) return { action: "skip", reason: "unchanged for target block" };
  }
  return { action: "push", price, clamped };
}
