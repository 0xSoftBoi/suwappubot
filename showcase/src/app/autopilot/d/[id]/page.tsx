import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { API_BASE_URL } from '@/lib/links';
import { VerifyBadge } from '../../AutopilotFeed';
import type { AutopilotDecision } from '../../types';
import styles from '../../autopilot.module.css';

export const revalidate = 60;

async function getDecision(id: string): Promise<AutopilotDecision | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/autopilot/decisions/${id}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { decision?: AutopilotDecision };
    return data.decision ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const d = await getDecision(id);
  if (!d) return { title: 'Decision | Suwappu Autopilot' };
  const verb = !d.gate_passed ? 'Refused' : d.action === 'sell' ? 'Sold' : 'Bought';
  return {
    title: `${verb} ${d.symbol} | Suwappu Autopilot`,
    description: d.headline ?? `Autopilot decision #${d.id} on ${d.chain}.`,
  };
}

function money(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return n >= 1 ? `$${n.toFixed(2)}` : `$${Number(n.toPrecision(4))}`;
}

/**
 * One decision, addressable.
 *
 * A feed you can only scroll is not a record — a claim about a specific call
 * has to be linkable. This page is what you send someone when you want them to
 * check a single decision, hash and all.
 */
export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getDecision(id);
  if (!d) notFound();

  const refused = !d.gate_passed;
  const evidence = (d.thesis?.evidence ?? {}) as Record<string, unknown>;
  const failed = d.gates.filter((g) => !g.passed);

  return (
    <>
      <SummerNav />
      <main className={styles.shell}>
        <div className={styles.wrap}>
          <a className={styles.back} href="/autopilot">
            ← All decisions
          </a>

          <header className={styles.header}>
            <div>
              <h1 className={styles.title}>
                {refused ? 'Refused' : d.action === 'sell' ? 'Sold' : 'Bought'} {d.symbol}
              </h1>
              <p className={styles.subtitle}>{d.headline}</p>
            </div>
            <VerifyBadge decision={d} />
          </header>

          <section className={styles.detailGrid} aria-label="Decision facts">
            <div className={styles.stat}>
              <p className={styles.statLabel}>Chain</p>
              <p className={styles.statValue}>{d.chain}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Size</p>
              <p className={styles.statValue}>{refused ? '—' : money(d.size_usd)}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Confidence</p>
              <p className={styles.statValue}>
                {d.confidence === null ? '—' : d.confidence.toFixed(2)}
              </p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Fill</p>
              <p className={styles.statValue}>{money(d.fill_price_usd)}</p>
            </div>
            <div className={styles.stat}>
              <p className={styles.statLabel}>Status</p>
              <p className={styles.statValue}>{d.status}</p>
            </div>
          </section>

          {refused && d.rejection_reason && (
            <p className={styles.refusal}>refused — {d.rejection_reason}</p>
          )}

          {d.thesis?.reasoning && (
            <>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Thesis</h2>
                <p className={styles.sectionNote}>
                  revealed {d.revealed_at ? new Date(d.revealed_at).toISOString() : '—'}
                </p>
              </div>
              <p className={styles.thesis}>{d.thesis.reasoning}</p>
            </>
          )}

          {Object.keys(evidence).length > 0 && (
            <>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Evidence it rested on</h2>
              </div>
              <ul className={styles.evidence}>
                {Object.entries(evidence).map(([k, v]) => (
                  <li key={k}>
                    {k} <strong>{String(v)}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Gate verdict</h2>
            <p className={styles.sectionNote}>
              {failed.length === 0
                ? `${d.gates.length} rules, all passed`
                : `${failed.length} of ${d.gates.length} rules failed`}
            </p>
          </div>
          <ul className={styles.gateList}>
            {d.gates.map((g) => (
              <li key={g.rule} className={g.passed ? styles.gatePass : styles.gateFail}>
                {g.passed ? '✓' : '✗'} {g.rule} — {g.detail}
              </li>
            ))}
          </ul>

          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Proof</h2>
            <p className={styles.sectionNote}>sealed {new Date(d.sealed_at).toISOString()}</p>
          </div>
          <ul className={styles.evidence}>
            <li>
              algo <strong>{d.seal_algo}</strong>
            </li>
            <li className={styles.hash}>
              commitment <strong>{d.commitment}</strong>
            </li>
            {d.nonce && (
              <li className={styles.hash}>
                nonce <strong>{d.nonce}</strong>
              </li>
            )}
            <li className={styles.hash}>
              memo <strong>{d.seal_memo}</strong>
            </li>
            {d.seal_tx_hash && (
              <li className={styles.hash}>
                anchored on {d.seal_chain} <strong>{d.seal_tx_hash}</strong>
              </li>
            )}
            {d.tx_hash && (
              <li className={styles.hash}>
                execution tx <strong>{d.tx_hash}</strong>
              </li>
            )}
          </ul>

          <section className={styles.explain}>
            <div className={styles.explainItem}>
              <h3>The badge above is not our word</h3>
              <p>
                Your browser recomputed{' '}
                <code>sha256(&quot;{d.seal_algo}|&quot; + nonce + &quot;|&quot; + canonical_thesis)</code>{' '}
                with WebCrypto and compared it to the commitment stored before execution. Nothing
                on this page asked our API whether the hash was valid.
              </p>
            </div>
            <div className={styles.explainItem}>
              <h3>Do it without us</h3>
              <p>
                Canonical JSON here means object keys sorted lexicographically, no whitespace, and
                strings as raw UTF-8 — non-ASCII is <em>not</em> <code>\uXXXX</code>-escaped, so
                Python needs <code>ensure_ascii=False</code> and Go needs{' '}
                <code>SetEscapeHTML(false)</code>. The verify endpoint publishes the exact
                pre-image; <code>sha256(preimage)</code> must equal the commitment in any language.
              </p>
            </div>
          </section>
        </div>
      </main>
      <SummerFooter />
    </>
  );
}
