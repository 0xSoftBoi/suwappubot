import type { PriceSource } from "./types";
import { bpsDiff, E18 } from "./types";

export type AggResult =
  | { ok: true; price: bigint; used: string[]; spreadBps: number }
  | { ok: false; reason: string };

export interface AggParams {
  minSources: number;
  maxAgeMs: number;
  outlierBps: number;
  maxDisagreeBps: number;
  maxDepegBps: number;
}

function median(xs: bigint[]): bigint {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2n;
}

export class Aggregator {
  constructor(private sources: PriceSource[], private p: AggParams, private quote: PriceSource | null = null) {}

  start() {
    this.sources.forEach((s) => s.start());
    this.quote?.start();
  }
  stop() {
    this.sources.forEach((s) => s.stop());
    this.quote?.stop();
  }

  read(now = Date.now()): AggResult {
    const fresh: { name: string; price: bigint }[] = [];
    for (const s of this.sources) {
      const t = s.latest();
      if (!t || t.price <= 0n) continue;
      if (now - t.ts > this.p.maxAgeMs) continue;
      if (t.ts - now > 2000) continue; // future-dated beyond clock skew allowance
      fresh.push({ name: s.name, price: t.price });
    }
    if (fresh.length < this.p.minSources) return { ok: false, reason: `fresh sources ${fresh.length} < ${this.p.minSources}` };

    let set = fresh;
    if (set.length >= 3) {
      const m = median(set.map((x) => x.price));
      set = set.filter((x) => bpsDiff(x.price, m) <= this.p.outlierBps);
      if (set.length < this.p.minSources) return { ok: false, reason: `after outlier rejection ${set.length} < ${this.p.minSources}` };
    }
    const prices = set.map((x) => x.price);
    const lo = prices.reduce((a, b) => (a < b ? a : b));
    const hi = prices.reduce((a, b) => (a > b ? a : b));
    const spreadBps = bpsDiff(hi, lo);
    if (spreadBps > this.p.maxDisagreeBps) return { ok: false, reason: `sources disagree ${spreadBps.toFixed(1)}bps > ${this.p.maxDisagreeBps}` };
    let price = median(prices);
    const used = set.map((x) => x.name);
    if (this.quote) {
      // base/USD -> base/USDC: divide by USDC/USD. Halt-grade guard on a quote-asset depeg.
      const q = this.quote.latest();
      if (!q || q.price <= 0n || now - q.ts > this.p.maxAgeMs) return { ok: false, reason: "quote-asset (USDC/USD) price missing or stale" };
      const dep = bpsDiff(q.price, E18);
      if (dep > this.p.maxDepegBps) return { ok: false, reason: `quote asset depeg ${dep.toFixed(1)}bps > ${this.p.maxDepegBps}` };
      price = (price * E18) / q.price;
      used.push("usdc-adj");
    }
    return { ok: true, price, used, spreadBps };
  }
}
