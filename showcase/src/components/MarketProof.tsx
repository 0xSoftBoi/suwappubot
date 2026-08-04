/**
 * MarketProof — replaces the old hard-coded "market proof" table (which shipped
 * stale static prices labelled as proof). Async server component: fetches real
 * spot prices server-side with 60s ISR revalidation, so the values are genuinely
 * live and land in the SSR HTML. Falls back gracefully (no stale data shown as
 * live) if the upstream is unavailable. Routes are labelled as illustrative best
 * venues, not literal executed trades.
 */

const PAIRS: { pair: string; id: string; route: string }[] = [
  { pair: 'ETH/USDC', id: 'ethereum', route: 'Uniswap V3' },
  { pair: 'BTC/USDC', id: 'bitcoin', route: '1inch Fusion' },
  { pair: 'SOL/USDC', id: 'solana', route: 'Jupiter' },
];

interface CgEntry {
  usd?: number;
  usd_24h_change?: number;
}

function fmtPrice(n: number): string {
  return (
    '$' +
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function fmtChange(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

async function getMarket(): Promise<Record<string, CgEntry> | null> {
  // Hard timeout so a slow/rate-limited upstream can never block SSR (and the
  // Railway healthcheck). Falls back to the graceful "—" rows on abort.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,solana&vs_currencies=usd&include_24hr_change=true',
      { next: { revalidate: 60 }, signal: controller.signal },
    );
    if (!res.ok) return null;
    return (await res.json()) as Record<string, CgEntry>;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function MarketProof() {
  const data = await getMarket();
  const live = !!data;

  const rows = PAIRS.map((p) => {
    const d = data?.[p.id];
    const chg = d?.usd_24h_change;
    return {
      pair: p.pair,
      price: d?.usd != null ? fmtPrice(d.usd) : '—',
      change: chg != null ? fmtChange(chg) : '—',
      dir: chg == null ? 'flat' : chg >= 0 ? 'up' : 'down',
      route: p.route,
    };
  });
  // Gasless showcase row — a stable peg, not a market price.
  rows.push({ pair: 'USDC → pathUSD', price: '$1.00', change: 'gasless', dir: 'flat', route: 'Tempo' });

  const updated = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

  return (
    <section
      id="bot"
      aria-label="Live market prices"
      className="mx-auto max-w-5xl px-6 py-20 md:py-28"
    >
      <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h2 className="font-display text-2xl font-medium tracking-tight text-[var(--ink-0)] md:text-3xl">
          Real prices. Best-route execution.
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-[var(--ink-1)]">
          The markets you can trade right now — spot across chains plus a gasless stable swap
          on Tempo. Suwappu routes each to the best available venue.
        </p>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-white/10 bg-[var(--canvas-1)]">
        <div className="grid grid-cols-4 gap-4 border-b border-white/10 px-5 py-3 text-xs uppercase tracking-wide text-[var(--ink-1)]">
          <span>Pair</span>
          <span>Price</span>
          <span>24h</span>
          <span>Route</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.pair}
            className="grid grid-cols-4 gap-4 border-b border-white/5 px-5 py-3 text-sm text-[var(--ink-0)] last:border-b-0"
          >
            <span>{r.pair}</span>
            <span className="font-mono">{r.price}</span>
            <span
              className={
                r.dir === 'up'
                  ? 'font-mono text-emerald-400'
                  : r.dir === 'down'
                    ? 'font-mono text-rose-400'
                    : 'font-mono text-[var(--ink-1)]'
              }
            >
              {r.change}
            </span>
            <span className="text-[var(--ink-1)]">{r.route}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 flex items-center gap-2 text-xs text-[var(--ink-1)]">
        {live ? (
          <>
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Live spot prices via CoinGecko · updated {updated} UTC, refreshes every minute. Routes
            shown are typical best venues (illustrative).
          </>
        ) : (
          <>Live prices momentarily unavailable. Routes shown are typical best venues (illustrative).</>
        )}
      </p>
    </section>
  );
}
