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
import { Reveal, AuthorityFlow } from '@/components/v3';
import styles from './passport.module.css';
import '../product-v3.css';

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

      <main id="main-content" className={styles.shell}>
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

          <Reveal className={`v3-tone-dark pv3-panel ${styles.concept}`} delay={150}>
            <div className="pv3-panel__bar"><i /><i /><i /><span>Human proof, then a hook check on every trade</span></div>
            <div className="pv3-stagebox">
              <AuthorityFlow lanes={[['Human proof', 'Hook check', 'Trade allowed'], ['No proof', 'Hook check', 'Trade blocked']]} caption="How the hook decides, concept only" />
            </div>
          </Reveal>

          {notEnabled ? (
            <div className={styles.unavailable} role="status">
              <span className={styles.unavailableDot} aria-hidden="true" />
              <div>
                <span className={styles.bannerTitle}>Trust layer not enabled on this deploy.</span>
                <span className={styles.unavailableText}>
                  The demo endpoints (<code>/hackathon/*</code>) haven&rsquo;t shipped to this
                  environment yet, so the live walkthrough is off here.
                </span>
              </div>
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
