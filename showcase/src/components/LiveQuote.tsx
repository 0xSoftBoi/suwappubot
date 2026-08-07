'use client';

import { useEffect, useState, useCallback } from 'react';
import captured from '@/data/captured-quote.json';

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
 *
 * Fallback: /api/quote 503s with no SUWAPPU_DEMO_KEY set (e.g. preview
 * deploys) and can 502 if the upstream is down. Rather than show a dead
 * error box to every visitor in that state, fall back to a real response
 * captured manually from the production API (src/data/captured-quote.json)
 * and label it "captured <date>" — never "live". If a pair somehow has no
 * captured entry, this shows an honest "quote service unreachable" state
 * instead of fabricating a number.
 */

type Quote = {
  stale?: boolean;
  ageSeconds?: number;
  captured?: boolean;
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

const CAPTURED_QUOTES = captured.quotes as Record<string, Omit<Quote, 'captured'>>;
const CAPTURED_AT = captured.capturedAt;

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
      // Live proxy is down. Fall back to a real captured response rather
      // than a dead error box, labelled honestly as not live.
      const fallback = CAPTURED_QUOTES[p];
      if (fallback) {
        setQuote({ ...fallback, captured: true });
        setLeft(0);
        setState('idle');
      } else {
        setState('error');
      }
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
        <span
          className={`lq__title lq__title--${quote?.stale ? 'stale' : quote?.captured ? 'captured' : 'live'}`}
        >
          {quote?.stale ? 'Last quote' : quote?.captured ? 'Captured quote' : 'Live quote'}
        </span>
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
          <p>Quote service unreachable.</p>
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
          {quote.captured && (
            // Never present a checked-in fixture as live either.
            <p className="lq__stale">
              captured {CAPTURED_AT} from api.suwappu.bot, not live right now.
            </p>
          )}

          <dl className="lq__grid">
            <div><dt>Selected route</dt><dd>{quote.dex}</dd></div>
            <div><dt>Network fee</dt><dd>{quote.gasUsd}</dd></div>
            <div><dt>Price impact</dt><dd>{quote.priceImpact}</dd></div>
            <div>
              <dt>Quote expires</dt>
              <dd className={!quote.captured && left <= 10 ? 'lq__warn' : undefined}>
                {quote.captured ? '-' : left > 0 ? `${left}s` : 'expired'}
              </dd>
            </div>
          </dl>

          {quote.captured && (
            <button className="lq__retry" onClick={() => load(pair)}>Check live</button>
          )}
          {!quote.captured && left <= 0 && (
            <button className="lq__retry" onClick={() => load(pair)}>Get a fresh quote</button>
          )}
        </div>
      )}
    </div>
  );
}
