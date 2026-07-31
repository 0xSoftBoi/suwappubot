import { NextResponse } from 'next/server';

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

/** Only these exact demo routes are quotable through the public proxy. */
const ALLOWED = new Map<
  string,
  { from: string; to: string; chain: string; toChain?: string; amount: string }
>([
  ['usdc-eth-base', { from: 'USDC', to: 'ETH', chain: 'base', amount: '100' }],
  ['eth-usdc-base', { from: 'ETH', to: 'USDC', chain: 'base', amount: '0.1' }],
  // Cross-chain: these are the multi-stage routes, swap then bridge then swap.
  ['usdc-base-usdt-polygon', { from: 'USDC', to: 'USDT', chain: 'base', toChain: 'polygon', amount: '100' }],
  ['usdc-base-eth-arbitrum', { from: 'USDC', to: 'ETH', chain: 'base', toChain: 'arbitrum', amount: '100' }],
]);

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const key = process.env.SUWAPPU_DEMO_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'demo_key_missing', hint: 'Set SUWAPPU_DEMO_KEY to enable the live quote.' },
      { status: 503 }
    );
  }

  const pair = new URL(req.url).searchParams.get('pair') ?? 'usdc-eth-base';
  const route = ALLOWED.get(pair);
  if (!route) {
    return NextResponse.json({ error: 'pair_not_allowed' }, { status: 400 });
  }

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
      // A quote is only valid ~60s, so caching it any longer would be a lie.
      next: { revalidate: 30 },
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      // Fall back to the last real quote for this pair rather than erroring.
      const prev = lastGood.get(pair);
      if (prev) {
        return NextResponse.json({
          ...prev.body,
          stale: true,
          ageSeconds: Math.round((Date.now() - prev.at) / 1000),
        });
      }
      return NextResponse.json(
        { error: 'upstream_error', status: upstream.status, detail: data?.error ?? null },
        { status: 502 }
      );
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
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
