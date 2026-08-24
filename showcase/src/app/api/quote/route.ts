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

async function fetchQuote(
  pair: string,
  route: NonNullable<ReturnType<typeof getDemoQuotePair>>,
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
  const key = process.env.SUWAPPU_DEMO_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'demo_key_missing', hint: 'Set SUWAPPU_DEMO_KEY to enable the live quote.' },
      { status: 503 }
    );
  }

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
    const ttlSeconds = typeof fresh.body.expiresIn === 'number' ? fresh.body.expiresIn : 60;
    if (Date.now() - fresh.at < ttlSeconds * 1000) {
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
    pending = fetchQuote(pair, route, key);
    inflight.set(pair, pending);
    void pending.finally(() => inflight.delete(pair));
  }
  const result = await pending;

  if (result.ok) {
    return NextResponse.json(result.body);
  }
  return staleOr502(pair, result.status, result.detail);
}
