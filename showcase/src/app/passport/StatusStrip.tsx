'use client';

import { Evidence, HackathonStatus, ProviderState } from './api';
import styles from './passport.module.css';

function isOk(v: ProviderState | boolean | string | undefined): boolean | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return /ok|live|up|ready|true/i.test(v);
  if (typeof v.ok === 'boolean') return v.ok;
  if (typeof v.status === 'string') return /ok|live|up|ready/i.test(v.status);
  return null;
}

function receiptOk(receipts: Record<string, { status?: string }> | undefined, hash?: string) {
  if (!receipts || !hash) return false;
  const r = receipts[hash];
  return !!r && /success|1|confirmed|ok/i.test(String(r.status ?? ''));
}

const LABELS: Record<string, string> = {
  worldId: 'World ID',
  intercepta: 'Intercepta',
  uniswap: 'Uniswap v4 hook',
  ensv2: 'ENSv2',
};

const ORDER = ['worldId', 'uniswap', 'ensv2', 'intercepta'];

export default function StatusStrip({
  status,
  error,
  loading,
  evidence,
}: {
  status: HackathonStatus | null;
  error: string | null;
  loading: boolean;
  evidence?: Evidence | null;
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

  // The hook and the ENS names are live-or-not based on their own deploy/
  // registration receipts, not on unrelated provider wiring (the Trading API
  // key for Uniswap quoting, or the policy-gate RPC for ENSv2) — those can be
  // unconfigured on this deploy while the on-chain artifacts are still real.
  const uniswapLive = receiptOk(evidence?.receipts, evidence?.uniswap?.deployTx);
  const ensLive = receiptOk(evidence?.receipts, evidence?.ens?.sample?.txHash);

  const states: Record<string, 'up' | 'down' | 'unknown' | 'neutral'> = {
    worldId: (() => {
      const ok = isOk(providers.worldId as ProviderState);
      return ok === true ? 'up' : ok === false ? 'down' : 'unknown';
    })(),
    uniswap: uniswapLive ? 'up' : 'down',
    ensv2: ensLive ? 'up' : 'down',
    intercepta: 'neutral',
  };

  return (
    <div className={styles.statusStrip} role="status" aria-live="polite">
      {status?.trustLayer && <span className={styles.statusTrustLayer}>{status.trustLayer}</span>}
      <ul className={styles.statusList}>
        {ORDER.map((key) => {
          const state = states[key] ?? 'unknown';
          return (
            <li key={key} className={styles.statusItem}>
              <span className={styles.dot} data-state={state} aria-hidden="true" />
              {key === 'intercepta' ? `${LABELS[key]} — coming soon` : LABELS[key]}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
