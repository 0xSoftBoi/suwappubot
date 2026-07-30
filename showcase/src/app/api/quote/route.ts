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

/** Only these exact demo routes are quotable through the public proxy. */
const ALLOWED = new Map<string, { from: string; to: string; chain: string; amount: string }>([
  ['usdc-eth-base', { from: 'USDC', to: 'ETH', chain: 'base', amount: '100' }],
  ['usdc-eth-arbitrum', { from: 'USDC', to: 'ETH', chain: 'arbitrum', amount: '100' }],
  ['eth-usdc-base', { from: 'ETH', to: 'USDC', chain: 'base', amount: '0.1' }],
  ['usdc-sol-solana', { from: 'USDC', to: 'SOL', chain: 'solana', amount: '100' }],
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
        amount: route.amount,
      }),
      // A quote is only valid ~60s, so caching it any longer would be a lie.
      next: { revalidate: 30 },
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'upstream_error', status: upstream.status, detail: data?.error ?? null },
        { status: 502 }
      );
    }

    // Return only what the widget renders. No quote_id: this is a display
    // surface, not an execution path, and a quote_id invites misuse.
    return NextResponse.json({
      pair,
      from: { symbol: data.from_token?.symbol ?? route.from, amount: data.amount_in },
      to: { symbol: data.to_token?.symbol ?? route.to, amount: data.amount_out },
      chain: data.from_chain,
      rate: data.exchange_rate,
      priceImpact: data.price_impact,
      gasUsd: data.estimated_gas_usd,
      route: data.route,
      dex: data.dex,
      expiresIn: data.expires_in_seconds,
      fetchedAt: Date.now(),
    });
  } catch {
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
