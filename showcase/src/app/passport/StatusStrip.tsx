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

const LABELS: Record<string, string> = {
  worldId: 'World ID',
  intercepta: 'Intercepta',
  uniswap: 'Uniswap v4 hook',
  ensv2: 'ENSv2',
};

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
  const entries = Object.entries(providers);

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
