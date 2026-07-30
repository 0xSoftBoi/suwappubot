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
    <section id="bot" className="summer-proof" aria-label="Live market prices">
      <div className="summer-flower summer-flower--soft summer-proof__flower" aria-hidden="true" />
      <div className="summer-proof__head">
        <div>
          <h2>Real prices. Best-route execution.</h2>
        </div>
        <p>
          The markets you can trade right now: spot across chains plus a gasless stable swap
          on Tempo. Suwappu routes each to the best available venue.
        </p>
      </div>
      <div className="summer-table">
        <div className="summer-table__row summer-table__row--head">
          <span>Pair</span>
          <span>Price</span>
          <span>24h</span>
          <span>Route</span>
        </div>
        {rows.map((r) => (
          <div className="summer-table__row" key={r.pair}>
            <span>{r.pair}</span>
            <span>{r.price}</span>
            <span className={`summer-proof__chg summer-proof__chg--${r.dir}`}>{r.change}</span>
            <span>{r.route}</span>
          </div>
        ))}
      </div>
      <p className="summer-proof__note">
        {live ? (
          <>
            <span className="summer-proof__live" aria-hidden="true">
              <i />
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
