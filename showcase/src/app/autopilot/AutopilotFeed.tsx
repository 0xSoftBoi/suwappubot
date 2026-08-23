'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/links';
import type { AutopilotDecision } from './types';
import styles from './autopilot.module.css';

const POLL_MS = 20_000;

/** Prices span cents to thousands; significant digits beat a fixed decimal count. */
function price(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n >= 1 ? `$${n.toFixed(2)}` : `$${Number(n.toPrecision(4))}`;
}

function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta)) return '';
  const mins = Math.round(delta / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The decision feed — the actual product.
 *
 * Refusals render with the same weight as fills, because an agent that only
 * shows you its trades is showing you half the data. Nothing here is
 * synthesised: if the API is unreachable the component says so rather than
 * rendering plausible-looking rows.
 */
export default function AutopilotFeed({
  slug,
  initial,
}: {
  slug: string;
  initial: AutopilotDecision[];
}) {
  const [decisions, setDecisions] = useState<AutopilotDecision[]>(initial);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/autopilot/${slug}/decisions?limit=40`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { decisions?: AutopilotDecision[] };
      if (Array.isArray(data.decisions)) {
        setDecisions(data.decisions);
        setStale(false);
      }
    } catch {
      // Keep the last good data on screen and mark it stale — better than
      // blanking the feed or silently showing numbers that stopped updating.
      setStale(true);
    }
  }, [slug]);

  useEffect(() => {
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (decisions.length === 0) {
    return (
      <p className={styles.empty}>
        This agent has not made a decision yet. When it does, every one appears here —
        the ones it took and the ones it refused.
      </p>
    );
  }

  return (
    <>
      {stale && (
        <p className={styles.sectionNote}>
          Live updates paused — showing the last data received.
        </p>
      )}
      <ul className={styles.feed}>
        {decisions.map((d) => {
          const refused = !d.gate_passed;
          const cls = refused
            ? styles.cardRefused
            : d.action === 'sell'
              ? styles.cardSell
              : styles.cardBuy;
          const badgeCls = refused
            ? styles.badgeRefused
            : d.action === 'sell'
              ? styles.badgeSell
              : styles.badgeBuy;

          return (
            <li key={d.id} className={`${styles.card} ${cls}`}>
              <div className={styles.cardTop}>
                <span className={`${styles.badge} ${badgeCls}`}>
                  {refused ? 'refused' : d.action}
                </span>
                <span className={styles.symbol}>{d.symbol}</span>
                <span className={styles.chain}>{d.chain}</span>
                <span className={styles.time}>{relativeTime(d.sealed_at)}</span>
              </div>

              {d.headline && <p className={styles.headline}>{d.headline}</p>}

              {refused && d.rejection_reason && (
                <p className={styles.refusal}>refused — {d.rejection_reason}</p>
              )}

              <div className={styles.meta}>
                {!refused && <span>size ${d.size_usd.toFixed(2)}</span>}
                {d.confidence !== null && <span>confidence {d.confidence.toFixed(2)}</span>}
                {d.fill_price_usd !== null && !refused && (
                  <span>fill {price(d.fill_price_usd)}</span>
                )}
                <span>status {d.status}</span>
              </div>

              <details className={styles.details}>
                <summary>
                  {d.thesis ? 'Thesis, gate verdict and proof' : 'Gate verdict and proof'}
                </summary>

                {d.thesis?.reasoning && <p className={styles.thesis}>{d.thesis.reasoning}</p>}

                <ul className={styles.gateList}>
                  {d.gates.map((g) => (
                    <li
                      key={g.rule}
                      className={g.passed ? styles.gatePass : styles.gateFail}
                      title={g.detail}
                    >
                      {g.passed ? '✓' : '✗'} {g.rule}
                    </li>
                  ))}
                </ul>

                <p className={styles.meta}>
                  <span className={styles.hash}>commitment {d.commitment}</span>
                </p>
                <p className={styles.meta}>
                  <a
                    href={`${API_BASE_URL}/v1/autopilot/decisions/${d.id}/verify`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Verify this hash yourself →
                  </a>
                  {d.seal_tx_hash && (
                    <span className={styles.hash}>
                      anchored on {d.seal_chain}: {d.seal_tx_hash}
                    </span>
                  )}
                </p>
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}
