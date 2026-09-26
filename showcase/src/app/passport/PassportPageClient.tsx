'use client';

import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import AmbientOrb, { OrbState } from './AmbientOrb';
import NarrationFlow, { NarrationLine } from './NarrationFlow';
import QrModal from './QrModal';
import ResultCard from './PassportCard';
import TechnicalDetails from './TechnicalDetails';
import { usePassportFlow } from './usePassportFlow';
import styles from './passport.module.css';

function receiptOk(receipts: Record<string, { status?: string }> | undefined, hash?: string) {
  if (!receipts || !hash) return false;
  const r = receipts[hash];
  return !!r && /success|1|confirmed|ok/i.test(String(r.status ?? ''));
}

const EASE = [0.22, 1, 0.36, 1] as const;

export default function PassportPageClient() {
  const reduceMotion = useReducedMotion();
  const {
    trade,
    worldPhase,
    worldError,
    start,
    nullifier,
    beginVerification,
    cancelVerification,
    evidence,
    evidenceError,
    evidenceLoading,
    status,
    statusError,
    statusLoading,
  } = usePassportFlow();

  const started = worldPhase !== 'idle';
  const humanDone = worldPhase === 'verified';
  const humanFailed = worldPhase === 'failed' || worldPhase === 'error';
  const evidenceUnavailable = evidenceError === 'not-deployed';

  const ensName = evidence?.ens?.sample?.name;
  const ensLanded = !!evidence?.ens?.sample?.resolvedAddress;
  const swapHash = evidence?.uniswap?.swapTx;
  const swapLanded = receiptOk(evidence?.receipts, swapHash) || (!!swapHash && !evidence?.receipts);

  const resultReady = humanDone && !evidenceLoading;

  // Real-state narration — every line is a direct read of usePassportFlow /
  // evidence, never a timer pretending progress.
  const lines: NarrationLine[] = useMemo(() => {
    if (!started) return [];
    const out: NarrationLine[] = [];

    if (worldPhase === 'starting' || worldPhase === 'awaiting') {
      out.push({ id: 'human', text: "Asking you to prove you're a real person…", state: 'active' });
    } else if (humanDone) {
      out.push({ id: 'human', text: "Verified — you're human", state: 'done' });
    } else if (humanFailed) {
      // Raw fetch/verifier strings ("Failed to fetch", "http 400") stay in
      // Technical details; the narration speaks plainly.
      const unreachable = !worldError || /fetch|network|http|5\d\d/i.test(worldError);
      out.push({
        id: 'human',
        text: unreachable
          ? "Couldn't reach the verification service. Give it another try."
          : "We couldn't confirm you're human this time. Give it another try.",
        state: 'error',
      });
    }

    if (humanDone) {
      if (evidenceUnavailable) {
        out.push({ id: 'name', text: "Agent identity isn't live on this build yet.", state: 'unavailable' });
      } else if (evidenceError) {
        out.push({ id: 'name', text: "Couldn't fetch your agent's name.", state: 'error' });
      } else if (evidenceLoading) {
        out.push({ id: 'name', text: 'Giving your agent a name…', state: 'active' });
      } else if (ensLanded && ensName) {
        out.push({ id: 'name', text: ensName, state: 'done' });
      } else {
        out.push({ id: 'name', text: 'Giving your agent a name…', state: 'active' });
      }
    }

    if (humanDone && !evidenceUnavailable && !evidenceError && !evidenceLoading) {
      if (swapLanded) {
        out.push({ id: 'trading', text: 'Protected trading enabled', state: 'done' });
      } else {
        out.push({ id: 'trading', text: 'Unlocking protected trading…', state: 'active' });
      }
    }

    return out;
  }, [
    started,
    worldPhase,
    humanDone,
    humanFailed,
    worldError,
    evidenceUnavailable,
    evidenceError,
    evidenceLoading,
    ensLanded,
    ensName,
    swapLanded,
  ]);

  const orbState: OrbState = humanFailed
    ? 'error'
    : humanDone
      ? 'success'
      : worldPhase === 'starting' || worldPhase === 'awaiting' || (started && evidenceLoading)
        ? 'thinking'
        : 'idle';

  // The sheet is open only while worldPhase is starting/awaiting, so it
  // closes itself automatically the instant usePassportFlow's poll resolves
  // to verified or failed — no extra effect needed.
  const qrOpen = worldPhase === 'starting' || worldPhase === 'awaiting';

  const agentDisplayName = ensName || trade.agentId;

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
            <h1 className={styles.h1}>Give your AI agent an identity people can trust.</h1>
            <p className={styles.lede}>
              A human confirms they&rsquo;re real, and every trade the agent makes after that is
              covered by that trust — automatically.
            </p>
          </motion.div>

          <motion.div
            layout
            className={styles.flowStage}
            transition={{ duration: 0.5, ease: EASE }}
          >
            {resultReady ? (
              <ResultCard agentName={agentDisplayName} />
            ) : (
              <>
                <motion.button
                  layout="position"
                  type="button"
                  className={styles.cta}
                  onClick={() => (worldPhase === 'awaiting' ? cancelVerification() : beginVerification())}
                  disabled={worldPhase === 'starting'}
                >
                  {worldPhase === 'starting'
                    ? 'Starting…'
                    : worldPhase === 'awaiting'
                      ? 'Cancel'
                      : humanFailed
                        ? 'Try again'
                        : 'Get your agent a passport'}
                </motion.button>

                <NarrationFlow lines={lines} />
              </>
            )}
          </motion.div>

          <p className={styles.poweredBy}>Powered by World · ENS · Uniswap</p>
        </section>

        <QrModal open={qrOpen} connectorURI={start?.connectorURI ?? null} onClose={cancelVerification} />

        <TechnicalDetails
          status={status}
          statusError={statusError}
          statusLoading={statusLoading}
          nullifier={nullifier}
          evidence={evidence}
          evidenceError={evidenceError}
        />
      </main>

      <SummerFooter />
    </div>
  );
}
