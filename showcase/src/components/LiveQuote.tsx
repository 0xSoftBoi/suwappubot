'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * LiveQuote: a real quote from the real router, in the hero.
 *
 * This replaces the scripted `<div>` terminal. Every number here comes from
 * POST /v1/agent/quote via the server proxy at /api/quote. The API returns
 * the winning route only, not the losing routers, so this deliberately does
 * NOT render a leaderboard of competing prices: that would be invented.
 *
 * `variant` only changes class names, so the three hero candidates can share
 * one implementation and one data path.
 */

type Quote = {
  stale?: boolean;
  ageSeconds?: number;
  from: { symbol: string; amount: string };
  to: { symbol: string; amount: string };
  chain: string;
  rate: string;
  priceImpact: string;
  gasUsd: string;
  route: string;
  dex: string;
  expiresIn: number;
};

const PAIRS = [
  { id: 'usdc-eth-base', label: '100 USDC to ETH' },
  { id: 'eth-usdc-base', label: '0.1 ETH to USDC' },
  { id: 'usdc-sol-solana', label: '100 USDC to SOL' },
] as const;

export default function LiveQuote({ variant = 'dark' }: { variant?: 'dark' | 'warm' }) {
  const [pair, setPair] = useState<string>(PAIRS[0].id);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('loading');
  const [left, setLeft] = useState(0);

  const load = useCallback(async (p: string) => {
    setState('loading');
    try {
      const r = await fetch(`/api/quote?pair=${encodeURIComponent(p)}`);
      if (!r.ok) throw new Error(String(r.status));
      const d: Quote = await r.json();
      setQuote(d);
      setLeft(d.expiresIn ?? 60);
      setState('idle');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => { load(pair); }, [pair, load]);

  // The countdown is the honest "live" signal: a quote really does expire.
  useEffect(() => {
    if (state !== 'idle' || left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, state]);

  const c = `lq lq--${variant}`;

  return (
    <div className={c}>
      <div className="lq__bar">
        <span className="lq__title">{quote?.stale ? 'Last quote' : 'Live quote'}</span>
        <span className="lq__src">api.suwappu.bot/v1/agent/quote</span>
      </div>

      <div className="lq__pairs" role="tablist" aria-label="Demo pair">
        {PAIRS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={pair === p.id}
            className={`lq__pair${pair === p.id ? ' lq__pair--on' : ''}`}
            onClick={() => setPair(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {state === 'error' && (
        <div className="lq__body lq__body--error">
          <p>Could not reach the router just now.</p>
          <button className="lq__retry" onClick={() => load(pair)}>Try again</button>
        </div>
      )}

      {state === 'loading' && (
        <div className="lq__body">
          <div className="lq__skel lq__skel--xl" />
          <div className="lq__skel" />
          <div className="lq__skel lq__skel--sm" />
        </div>
      )}

      {state === 'idle' && quote && (
        <div className="lq__body">
          <div className="lq__out">
            <span className="lq__num">{quote.to.amount}</span>
            <span className="lq__sym">{quote.to.symbol}</span>
          </div>
          <p className="lq__sub">
            for {quote.from.amount} {quote.from.symbol} on {quote.chain}
          </p>
          {quote.stale && (
            // Never present a cached quote as live.
            <p className="lq__stale">
              last quote, {quote.ageSeconds}s ago. Live quoting is paused.
            </p>
          )}

          <dl className="lq__grid">
            <div><dt>Best route</dt><dd>{quote.dex}</dd></div>
            <div><dt>Network fee</dt><dd>{quote.gasUsd}</dd></div>
            <div><dt>Price impact</dt><dd>{quote.priceImpact}</dd></div>
            <div>
              <dt>Quote expires</dt>
              <dd className={left <= 10 ? 'lq__warn' : undefined}>
                {left > 0 ? `${left}s` : 'expired'}
              </dd>
            </div>
          </dl>

          {left <= 0 && (
            <button className="lq__retry" onClick={() => load(pair)}>Get a fresh quote</button>
          )}
        </div>
      )}
    </div>
  );
}
