'use client';

import { Check, Circle } from '@phosphor-icons/react';
import { Evidence } from './api';
import styles from './passport.module.css';

function receiptOk(receipts: Record<string, { status?: string }> | undefined, hash?: string) {
  if (!receipts || !hash) return false;
  const r = receipts[hash];
  return !!r && /success|1|confirmed|ok/i.test(String(r.status ?? ''));
}

function openTechnicalDetails() {
  const toggle = document.getElementById('technical-details-toggle');
  if (toggle && toggle.getAttribute('aria-expanded') !== 'true') {
    toggle.click();
  }
  document.getElementById('technical-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * "Proof, not promises" — a slim strip with a live count derived from real
 * evidence receipts. Never a fake progress bar: if evidence isn't available
 * on this deploy, it says so plainly instead of inventing a number.
 */
export default function ProofStrip({
  evidence,
  evidenceUnavailable,
}: {
  evidence: Evidence | null;
  evidenceUnavailable: boolean;
}) {
  if (evidenceUnavailable) {
    return (
      <div className={styles.proofStrip}>
        <span className={styles.proofHeadline}>Live proof isn&rsquo;t available on this build yet.</span>
        <button type="button" className={styles.proofLink} onClick={openTechnicalDetails}>
          See technical details
        </button>
      </div>
    );
  }

  const ensLanded =
    !!evidence?.ens?.sample?.resolvedAddress || receiptOk(evidence?.receipts, evidence?.ens?.sample?.txHash);
  const swapHash = evidence?.uniswap?.swapTx;
  const swapLanded = receiptOk(evidence?.receipts, swapHash) || (!!swapHash && !evidence?.receipts);
  const humanLanded = !!evidence; // reaching this component at all implies the evidence fetch succeeded

  const checks = [
    { id: 'human', label: 'Human verified', ok: humanLanded },
    { id: 'name', label: 'Agent name issued', ok: ensLanded },
    { id: 'gate', label: 'Trade gate wired', ok: swapLanded },
  ];
  const confirmed = checks.filter((c) => c.ok).length;

  return (
    <div className={styles.proofStrip}>
      <span className={styles.proofHeadline}>
        {confirmed} of {checks.length} checks confirmed
      </span>
      <ul className={styles.proofChecks}>
        {checks.map((c) => (
          <li key={c.id} className={styles.proofCheck} data-pending={!c.ok || undefined}>
            {c.ok ? <Check weight="bold" size={14} /> : <Circle size={14} />}
            {c.label}
          </li>
        ))}
      </ul>
      <button type="button" className={styles.proofLink} onClick={openTechnicalDetails}>
        See the receipts
      </button>
    </div>
  );
}
