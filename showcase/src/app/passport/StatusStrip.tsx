'use client';

import { HackathonStatus, ProviderState } from './api';
import styles from './passport.module.css';

function isOk(v: ProviderState | boolean | string | undefined): boolean | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return /ok|live|up|ready|true/i.test(v);
  if (typeof v.ok === 'boolean') return v.ok;
  if (typeof v.status === 'string') return /ok|live|up|ready/i.test(v.status);
  return null;
}

// Only the provider whose liveness the page actually depends on is shown from
// the status payload. `intercepta` is out of scope for the demo, and the
// `uniswap` / `ensv2` flags in /hackathon/status refer to the optional
// Trading-API comparison and the on-chain policy gate — not to the hook and
// ENS subnames this page exercises live in beats 1–3 — so listing them as
// "down" would be misleading.
const LABELS: Record<string, string> = {
  worldId: 'World ID verifier',
};
const SHOWN = new Set(Object.keys(LABELS));

export default function StatusStrip({
  status,
  error,
  loading,
}: {
  status: HackathonStatus | null;
  error: string | null;
  loading: boolean;
}) {
  if (loading && !status && !error) {
    return <div className={styles.statusStrip} aria-live="polite">Checking live trust layer…</div>;
  }

  if (error && !status) {
    return (
      <div className={`${styles.statusStrip} ${styles.statusStripError}`} role="status">
        <span className={styles.dot} data-state="down" />
        Status endpoint unreachable — {error}
      </div>
    );
  }

  const providers = status?.providers || {};
  const entries = Object.entries(providers).filter(([key]) => SHOWN.has(key));

  return (
    <div className={styles.statusStrip} role="status" aria-live="polite">
      {status?.trustLayer && <span className={styles.statusTrustLayer}>{status.trustLayer}</span>}
      <ul className={styles.statusList}>
        {(entries.length ? entries : Object.entries(LABELS)).map(([key, value]) => {
          const ok = isOk(value as ProviderState);
          const state = ok === true ? 'up' : ok === false ? 'down' : 'unknown';
          return (
            <li key={key} className={styles.statusItem}>
              <span className={styles.dot} data-state={state} aria-hidden="true" />
              {LABELS[key] || key}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
