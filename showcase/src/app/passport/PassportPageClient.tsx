'use client';

import { motion, useReducedMotion } from 'framer-motion';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import AmbientOrb, { OrbState } from './AmbientOrb';
import StatusStrip from './StatusStrip';
import CopyField from './CopyField';
import { HOOK_ADDRESS, etherscanAddress, etherscanTx } from './api';
import { usePassportFlow } from './usePassportFlow';
import PassportStepper from './PassportStepper';
import styles from './passport.module.css';

const EASE = [0.22, 1, 0.36, 1] as const;

export default function PassportPageClient() {
  const reduceMotion = useReducedMotion();
  const flow = usePassportFlow();
  const {
    status,
    statusError,
    statusLoading,
    swaps,
    swapBeat,
    verifyPhase,
    humanVerified,
    evidence,
    evidenceError,
  } = flow;

  const enabled = status?.trustLayer !== undefined || !statusError;
  const notEnabled = !statusLoading && !!statusError && !status;

  const swapPhase = swaps[swapBeat].phase;

  const orbState: OrbState =
    swapPhase === 'checking' || swapPhase === 'submitted' || verifyPhase === 'starting' || verifyPhase === 'pending' || verifyPhase === 'provisioning'
      ? 'thinking'
      : swapPhase === 'executed' || humanVerified
        ? 'success'
        : swapPhase === 'failed' || verifyPhase === 'failed' || verifyPhase === 'error'
          ? 'error'
          : 'idle';

  const qrOpen = verifyPhase === 'starting' || verifyPhase === 'pending' || verifyPhase === 'provisioning';

  return (
    <div className={`summer-page ${styles.canvas}`}>
      <SummerNav />

      <main className={styles.shell}>
        <section className={styles.hero}>
          <AmbientOrb state={orbState} />

          <motion.div
            className={styles.heroCopy}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <h1 className={styles.h1}>Agent Swap Passport</h1>
            <p className={styles.lede}>
              A human proves they&rsquo;re real once. From then on, a Uniswap v4 hook checks that
              proof on every trade the agent&rsquo;s wallet tries to make.
            </p>
          </motion.div>

          {notEnabled ? (
            <div className={styles.banner} data-tone="pending">
              <span className={styles.bannerTitle}>Trust layer not enabled on this deploy.</span>
              <span>
                {statusError} — the demo endpoints (<code>/hackathon/*</code>) haven&rsquo;t shipped
                to this environment yet.
              </span>
            </div>
          ) : (
            <PassportStepper flow={flow} />
          )}

          <p className={styles.poweredBy}>Powered by World · ENS · Uniswap</p>
        </section>

        <section className={styles.techSection}>
          <span className={styles.beatKicker}>Reference deployment</span>
          <div className={styles.techBody} style={{ marginTop: 12 }}>
            <StatusStrip status={status} error={statusError} loading={statusLoading} />
            {evidenceError === 'not-deployed' ? (
              <p className={styles.hint}>
                <code>/hackathon/evidence</code> isn&rsquo;t live on this deploy yet.
              </p>
            ) : (
              <>
                <div className={styles.techRow}>
                  <span className={styles.techLabel}>Hook</span>
                  <CopyField value={HOOK_ADDRESS} href={etherscanAddress(HOOK_ADDRESS)} />
                </div>
                {evidence?.uniswap?.deployTx && (
                  <div className={styles.techRow}>
                    <span className={styles.techLabel}>Hook deploy tx</span>
                    <CopyField value={evidence.uniswap.deployTx} href={etherscanTx(evidence.uniswap.deployTx)} />
                  </div>
                )}
                {evidence?.ens?.parent && (
                  <div className={styles.techRow}>
                    <span className={styles.techLabel}>ENS parent</span>
                    <span>{evidence.ens.parent}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      <SummerFooter />
    </div>
  );
}
