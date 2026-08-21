'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DEMO_QUOTE_PAIRS, type DemoQuotePairId } from '@/lib/demoQuotePairs';

/**
 * A read-only execution ticket backed by the production quote endpoint.
 *
 * The widget deliberately renders only what the quote response can prove. It
 * never invents competing prices or substitutes sample pricing when live
 * access is unavailable. Simulation and authorization are separate lifecycle
 * steps described by the page below this ticket.
 */
type Quote = {
  stale?: boolean;
  ageSeconds?: number;
  from: { symbol: string; amount: string };
  to: { symbol: string; amount: string };
  chain: string;
  toChain?: string;
  crossChain?: boolean;
  bridgeFeeUsd?: string | null;
  etaSeconds?: number | null;
  rate?: string;
  priceImpact?: string | null;
  gasUsd?: string | null;
  route?: string | null;
  dex?: string | null;
  expiresIn: number;
  fetchedAt?: number;
};

export default function LiveQuote({ variant = 'dark' }: { variant?: 'dark' | 'warm' }) {
  const t = useTranslations('home.quote');
  const [pair, setPair] = useState<DemoQuotePairId>(DEMO_QUOTE_PAIRS[0].id);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('loading');
  const [left, setLeft] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);

  const pairLabels: Record<DemoQuotePairId, string> = {
    'usdc-eth-base': t('pairs.baseEth'),
    'usdc-base-usdt-polygon': t('pairs.basePolygon'),
    'usdc-base-eth-arbitrum': t('pairs.baseArbitrum'),
  };

  const load = useCallback(async (p: DemoQuotePairId) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState('loading');
    setQuote(null);

    try {
      const response = await fetch(`/api/quote?pair=${encodeURIComponent(p)}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      const nextQuote: Quote = await response.json();
      if (controller.signal.aborted || activeRequest.current !== controller) return;

      const fetchedAt = nextQuote.fetchedAt ?? Date.now();
      const ageSeconds = Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000));
      const remaining = Math.max(0, (nextQuote.expiresIn ?? 60) - ageSeconds);
      setQuote(nextQuote);
      setLeft(nextQuote.stale ? 0 : remaining);
      setState('idle');
    } catch {
      if (controller.signal.aborted) return;
      setQuote(null);
      setLeft(0);
      setState('error');
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, []);

  useEffect(() => {
    void load(pair);
    return () => activeRequest.current?.abort();
  }, [pair, load]);

  useEffect(() => {
    if (state !== 'idle' || !quote || quote.stale || left <= 0) return;
    const timer = setTimeout(() => setLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [left, quote, state]);

  const expired = Boolean(state === 'idle' && quote && !quote.stale && left <= 0);
  const statusKind =
    state === 'loading'
      ? 'loading'
      : state === 'error'
        ? 'unavailable'
        : quote?.stale
          ? 'stale'
          : expired
            ? 'expired'
            : 'live';
  const statusLabel =
    statusKind === 'loading'
      ? t('stateChecking')
      : statusKind === 'unavailable'
        ? t('stateUnavailable')
        : statusKind === 'stale'
          ? t('stateStale')
          : statusKind === 'expired'
            ? t('stateExpired')
            : t('stateLive');
  const routeLabel =
    quote?.crossChain && quote.toChain ? `${quote.chain} → ${quote.toChain}` : quote?.chain;

  return (
    <div className={`lq lq--${variant}`} aria-busy={state === 'loading'}>
      <div className="lq__bar">
        <span className={`lq__title lq__title--${statusKind}`} aria-live="polite">
          {statusLabel}
        </span>
        <span className="lq__src">api.suwappu.bot/v1/agent/quote</span>
      </div>

      <div className="lq__pairs" role="group" aria-label={t('presetLabel')}>
        {DEMO_QUOTE_PAIRS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={pair === preset.id}
            className={`lq__pair${pair === preset.id ? ' lq__pair--on' : ''}`}
            onClick={() => setPair(preset.id)}
          >
            {pairLabels[preset.id]}
          </button>
        ))}
      </div>

      {state === 'error' && (
        <div className="lq__body lq__body--error">
          <p role="status">{t('unavailable')}</p>
          <button type="button" className="lq__retry" onClick={() => void load(pair)}>
            {t('retry')}
          </button>
        </div>
      )}

      {state === 'loading' && (
        <div className="lq__body" aria-hidden="true">
          <div className="lq__skel lq__skel--xl" />
          <div className="lq__skel" />
          <div className="lq__skel lq__skel--sm" />
        </div>
      )}

      {state === 'idle' && quote && (
        <div className={`lq__body${expired ? ' lq__body--expired' : ''}`}>
          <div className="lq__out">
            <span className="lq__num">{quote.to.amount}</span>
            <span className="lq__sym">{quote.to.symbol}</span>
          </div>
          <p className="lq__sub">
            {t('forRoute', {
              amount: quote.from.amount,
              symbol: quote.from.symbol,
              route: routeLabel ?? t('unknown'),
            })}
          </p>
          {quote.stale && (
            <p className="lq__stale">
              {t('staleMessage', { seconds: quote.ageSeconds ?? 0 })}
            </p>
          )}

          <dl className="lq__grid">
            <div><dt>{t('selectedRoute')}</dt><dd>{quote.route || quote.dex || '—'}</dd></div>
            <div><dt>{t('networkFee')}</dt><dd>{quote.gasUsd || '—'}</dd></div>
            <div><dt>{t('priceImpact')}</dt><dd>{quote.priceImpact || '—'}</dd></div>
            <div>
              <dt>{t('quoteExpires')}</dt>
              <dd className={!quote.stale && left <= 10 ? 'lq__warn' : undefined}>
                {quote.stale ? '—' : expired ? t('expired') : t('seconds', { seconds: left })}
              </dd>
            </div>
          </dl>

          {(expired || quote.stale) && (
            <button type="button" className="lq__retry" onClick={() => void load(pair)}>
              {t('freshQuote')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
