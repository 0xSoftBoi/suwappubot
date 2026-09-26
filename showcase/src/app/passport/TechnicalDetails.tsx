'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CaretDown } from '@phosphor-icons/react';
import StatusStrip from './StatusStrip';
import CopyField from './CopyField';
import { Evidence, HackathonStatus, etherscanAddress, etherscanTx } from './api';
import styles from './passport.module.css';

function receiptOk(receipts: Record<string, { status?: string }> | undefined, hash?: string) {
  if (!receipts || !hash) return false;
  const r = receipts[hash];
  return !!r && /success|1|confirmed|ok/i.test(String(r.status ?? ''));
}

/**
 * Everything a judge wants and a normal visitor doesn't: nullifier,
 * on-chain addresses/hashes, chain name, provider status, the Intercepta
 * scope note. Collapsed by default — this is the ONLY place on the page
 * where chain jargon is allowed to live.
 */
export default function TechnicalDetails({
  status,
  statusError,
  statusLoading,
  nullifier,
  evidence,
  evidenceError,
}: {
  status: HackathonStatus | null;
  statusError: string | null;
  statusLoading: boolean;
  nullifier: string | null;
  evidence: Evidence | null;
  evidenceError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const evidenceUnavailable = evidenceError === 'not-deployed';
  const swapHash = evidence?.uniswap?.swapTx;

  return (
    <section className={styles.techSection} id="technical-details">
      <button
        type="button"
        id="technical-details-toggle"
        className={styles.techToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Technical details</span>
        <CaretDown
          size={16}
          weight="bold"
          className={styles.techCaret}
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <motion.div
          className={styles.techBody}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <StatusStrip status={status} error={statusError} loading={statusLoading} evidence={evidence} />

          {nullifier && (
            <div className={styles.techRow}>
              <span className={styles.techLabel}>Nullifier</span>
              <CopyField value={nullifier} />
            </div>
          )}

          {evidenceUnavailable ? (
            <p className={styles.hint}>
              The evidence endpoint (<code>/hackathon/evidence</code>) 404s on this deploy — the API
              branch hasn&rsquo;t shipped yet. These fields populate live once it does.
            </p>
          ) : evidenceError ? (
            <p className={styles.hint}>Evidence unavailable: {evidenceError}</p>
          ) : (
            <>
              <div className={styles.techRow}>
                <span className={styles.techLabel}>Chain</span>
                <span>{evidence?.chainId ? `Sepolia (${evidence.chainId})` : '—'}</span>
              </div>
              <div className={styles.techRow}>
                <span className={styles.techLabel}>ENSv2 subregistry</span>
                {evidence?.ens?.subregistry ? (
                  <CopyField value={evidence.ens.subregistry} href={etherscanAddress(evidence.ens.subregistry)} />
                ) : (
                  <span>—</span>
                )}
              </div>
              <div className={styles.techRow}>
                <span className={styles.techLabel}>Registration tx</span>
                {evidence?.ens?.sample?.txHash ? (
                  <span className={styles.techTxCell}>
                    <CopyField value={evidence.ens.sample.txHash} href={etherscanTx(evidence.ens.sample.txHash)} />
                    <span
                      className={styles.receiptBadge}
                      data-state={receiptOk(evidence?.receipts, evidence.ens.sample.txHash) ? 'success' : 'pending'}
                    >
                      {receiptOk(evidence?.receipts, evidence.ens.sample.txHash) ? 'confirmed' : 'pending'}
                    </span>
                  </span>
                ) : (
                  <span>—</span>
                )}
              </div>
              <div className={styles.techRow}>
                <span className={styles.techLabel}>Uniswap v4 hook</span>
                {evidence?.uniswap?.hook ? (
                  <CopyField value={evidence.uniswap.hook} href={etherscanAddress(evidence.uniswap.hook)} />
                ) : (
                  <span>—</span>
                )}
              </div>
              <div className={styles.techRow}>
                <span className={styles.techLabel}>Hook deploy tx</span>
                {evidence?.uniswap?.deployTx ? (
                  <span className={styles.techTxCell}>
                    <CopyField value={evidence.uniswap.deployTx} href={etherscanTx(evidence.uniswap.deployTx)} />
                    <span
                      className={styles.receiptBadge}
                      data-state={receiptOk(evidence?.receipts, evidence.uniswap.deployTx) ? 'success' : 'pending'}
                    >
                      {receiptOk(evidence?.receipts, evidence.uniswap.deployTx) ? 'confirmed' : 'pending'}
                    </span>
                  </span>
                ) : (
                  <span>—</span>
                )}
              </div>
              <div className={styles.techRow}>
                <span className={styles.techLabel}>Swap tx</span>
                {swapHash ? (
                  <span className={styles.techTxCell}>
                    <CopyField value={swapHash} href={etherscanTx(swapHash)} />
                    <span
                      className={styles.receiptBadge}
                      data-state={receiptOk(evidence?.receipts, swapHash) ? 'success' : 'pending'}
                    >
                      {receiptOk(evidence?.receipts, swapHash) ? 'confirmed' : 'pending'}
                    </span>
                  </span>
                ) : (
                  <span>—</span>
                )}
              </div>
            </>
          )}

          <p className={styles.hint}>
            Intercepta&rsquo;s risk-scoring layer is coming soon — it wires pre-trade risk into the same
            gate and is out of scope for tonight&rsquo;s three sponsor tracks (World ID, ENS, Uniswap).
          </p>
        </motion.div>
      )}
    </section>
  );
}
