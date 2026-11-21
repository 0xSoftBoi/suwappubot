import { NextResponse } from 'next/server';
import { DEMO_QUOTE_PAIRS, getDemoQuotePair } from '@/lib/demoQuotePairs';

/**
 * Server-side proxy for the hero's live quote widget.
 *
 * The agent API requires a bearer key, so the key stays here and never
 * reaches the browser. Requests are restricted to a small allowlist of
 * demo pairs: this endpoint is public and every call spends a credit on
 * the demo agent, so arbitrary user input must not reach the upstream API.
 */

const UPSTREAM = 'https://api.suwappu.bot/v1/agent/quote';

/**
 * Preferred source: the keyless public preview route. It spends no credits but
 * has no server-side cache, so everything below (per-pair TTL, in-flight
 * dedupe, failure cooldown, stale-while-error) still protects it. The demo-key
 * route above is only the fallback when the preview is unavailable.
 */
const PUBLIC_PREVIEW = 'https://api.suwappu.bot/public/swap/preview';
/** An indicative preview has no validity window of its own, so the proxy sets one. */
const PUBLIC_TTL_MS = 30_000;

type DemoRoute = NonNullable<ReturnType<typeof getDemoQuotePair>>;

/** Demo pair -> preview query. The ONLY place that knows the preview's param names. */
function previewParams(route: DemoRoute): URLSearchParams {
  return new URLSearchParams({
    fromChain: route.chain,
    toChain: route.toChain ?? route.chain,
    fromToken: route.from,
    toToken: route.to,
    fromAmount: route.amount,
  });
}

/**
 * Preview response -> the body LiveQuote renders. The ONLY place that knows the
 * preview's response field names. Absent fields are omitted (null), never
 * invented: in particular there is no expiresIn (the preview is not executable)
 * and no quote id.
 */
/** 18-decimal base-unit strings do not fit the ticket: show 8 significant digits (display only). */
function display(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(Number(n.toPrecision(8)));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromPreview(pair: string, route: DemoRoute, d: Record<string, any>): Record<string, unknown> | null {
  if (d?.toAmount == null) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sym = (t: any, fallback: string) => (typeof t?.symbol === 'string' ? t.symbol : fallback);
  const str = (v: unknown) => (v == null || v === '' ? null : String(v));
  const impact = str(d.priceImpact);
  const gas = str(d.estimatedGasUsd);
  const toChain = route.toChain ?? route.chain;
  // The preview lists Suwappu's own fee as a `feeCollection` hop. It is a cost,
  // not a venue: keep it out of the route label and state it next to the total
  // price impact (which includes it) instead of hiding it there.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hops: any[] = Array.isArray(d.hops) ? d.hops : [];
  const venues = hops
    .filter((h) => h?.tool !== 'feeCollection' && typeof h?.toolName === 'string')
    .map((h) => h.toolName as string);
  const feeNum = Number(hops.find((h) => h?.tool === 'feeCollection')?.feeUsd);
  const fee = Number.isFinite(feeNum) && feeNum > 0 ? feeNum.toFixed(2) : null;
  const impactLabel = impact ? impact + '%' + (fee ? ' incl. $' + fee + ' fee' : '') : null;
  return {
    pair,
    indicative: d.executable === false,
    from: { symbol: sym(d.fromToken, route.from), amount: String(d.fromAmount ?? route.amount) },
    to: { symbol: sym(d.toToken, route.to), amount: display(d.toAmount) },
    chain: route.chain,
    toChain,
    crossChain: toChain !== route.chain,
    bridgeFeeUsd: str(d.bridgeFeeUsd),
    etaSeconds: typeof d.estimatedDurationSeconds === 'number' ? d.estimatedDurationSeconds : null,
    rate: str(d.exchangeRate) ?? undefined,
    priceImpact: impactLabel,
    gasUsd: gas ? `$${gas}` : null,
    route: venues.length ? venues.join(' → ') : str(d.route),
    dex: null,
    fetchedAt: Date.now(),
  };
}

async function fetchPublic(pair: string, route: DemoRoute): Promise<FetchResult> {
  try {
    const res = await fetch(`${PUBLIC_PREVIEW}?${previewParams(route)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, status: res.status, detail: null };
    const body = fromPreview(pair, route, await res.json());
    if (!body) return { ok: false, status: 502, detail: 'unexpected_shape' };
    lastGood.set(pair, { body, at: Date.now() });
    return { ok: true, body };
  } catch {
    return { ok: false, status: 502, detail: 'unreachable' };
  }
}

/**
 * Last known good quote per pair, held in module memory.
 *
 * The hero calls this on every page view and each call spends a credit on the
 * demo agent. When the balance runs out the upstream returns HTTP 402, and
 * without this the hero would show an error box to every visitor. Serving the
 * last real quote with its age, clearly labelled as stale, is honest and
 * degrades far better than a blank panel.
 */
const lastGood = new Map<string, { body: Record<string, unknown>; at: number }>();

/**
 * Credit-burn guards (money-path review findings on the shared cache):
 * - `inflight` collapses concurrent cache misses into ONE upstream call per
 *   pair. Without it, N parallel requests on a cold/expired key each spend a
 *   credit — the middleware deducts before the handler and never refunds.
 * - `lastFail` is a failure cooldown: a non-ok upstream response spends a
 *   credit and caches nothing, so during an upstream flap every page view
 *   would burn a credit. After a failure we wait FAIL_COOLDOWN_MS before
 *   trying upstream again, serving the stale lastGood (labelled) meanwhile.
 * Note: both maps are per-process; extra Railway replicas multiply the burn
 * by the replica count (showcase runs one replica today).
 */
type FetchResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; detail: unknown };

const inflight = new Map<string, Promise<FetchResult>>();
const lastFail = new Map<string, number>();
const FAIL_COOLDOWN_MS = 20_000;

export const dynamic = 'force-dynamic';

/** Public preview first; the metered demo-key path only when it is unavailable. */
async function fetchPreferred(pair: string, route: DemoRoute, key: string | undefined): Promise<FetchResult> {
  const pub = await fetchPublic(pair, route);
  if (pub.ok) return pub;
  if (!key) {
    lastFail.set(pair, Date.now());
    return pub;
  }
  return fetchQuote(pair, route, key);
}

async function fetchQuote(
  pair: string,
  route: DemoRoute,
  key: string
): Promise<FetchResult> {
  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from_token: route.from,
        to_token: route.to,
        chain: route.chain,
        ...(route.toChain ? { to_chain: route.toChain } : {}),
        amount: route.amount,
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      lastFail.set(pair, Date.now());
      return { ok: false, status: upstream.status, detail: data?.error ?? null };
    }

    // Return only what the widget renders. No quote_id: this is a display
    // surface, not an execution path, and a quote_id invites misuse.
    const body = {
      pair,
      from: { symbol: data.from_token?.symbol ?? route.from, amount: data.amount_in },
      to: { symbol: data.to_token?.symbol ?? route.to, amount: data.amount_out },
      chain: data.from_chain,
      toChain: data.to_chain,
      crossChain: data.from_chain !== data.to_chain,
      bridgeFeeUsd: data.bridge_fee_usd ?? null,
      etaSeconds: data.estimated_time_seconds ?? null,
      rate: data.exchange_rate,
      priceImpact: data.price_impact,
      gasUsd: data.estimated_gas_usd,
      route: data.route,
      dex: data.dex,
      expiresIn: data.expires_in_seconds,
      fetchedAt: Date.now(),
    };
    lastGood.set(pair, { body, at: Date.now() });
    lastFail.delete(pair);
    return { ok: true, body };
  } catch {
    lastFail.set(pair, Date.now());
    return { ok: false, status: 502, detail: 'unreachable' };
  }
}

function staleOr502(pair: string, status: number, detail: unknown): NextResponse {
  const prev = lastGood.get(pair);
  if (prev) {
    return NextResponse.json({
      ...prev.body,
      stale: true,
      ageSeconds: Math.round((Date.now() - prev.at) / 1000),
    });
  }
  return NextResponse.json({ error: 'upstream_error', status, detail }, { status: 502 });
}

export async function GET(req: Request) {
  // Optional now: the keyless preview is tried first; the key only powers the fallback.
  const key = process.env.SUWAPPU_DEMO_KEY || undefined;

  const pair = new URL(req.url).searchParams.get('pair') ?? DEMO_QUOTE_PAIRS[0].id;
  const route = getDemoQuotePair(pair);
  if (!route) {
    return NextResponse.json({ error: 'pair_not_allowed' }, { status: 400 });
  }

  // Serve a quote that is still inside its own validity window to everyone
  // instead of hitting the metered upstream per page view. The TTL comes from
  // the quote's own expiresIn (not a hardcoded 60s) so a shorter upstream
  // validity can never make us serve a dead quote as fresh.
  const fresh = lastGood.get(pair);
  if (fresh) {
    const ttlMs = typeof fresh.body.expiresIn === 'number' ? fresh.body.expiresIn * 1000 : PUBLIC_TTL_MS;
    if (Date.now() - fresh.at < ttlMs) {
      return NextResponse.json(fresh.body);
    }
  }

  // Failure cooldown: don't spend a credit per page view while upstream flaps.
  const failedAt = lastFail.get(pair);
  if (failedAt && Date.now() - failedAt < FAIL_COOLDOWN_MS) {
    return staleOr502(pair, 503, 'cooldown');
  }

  // Collapse concurrent misses into one upstream call (one credit).
  let pending = inflight.get(pair);
  if (!pending) {
    pending = fetchPreferred(pair, route, key);
    inflight.set(pair, pending);
    void pending.finally(() => inflight.delete(pair));
  }
  const result = await pending;

  if (result.ok) {
    return NextResponse.json(result.body);
  }
  return staleOr502(pair, result.status, result.detail);
}
