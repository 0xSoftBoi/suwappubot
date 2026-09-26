'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import AmbientOrb, { OrbState } from './AmbientOrb';
import NarrationFlow, { NarrationLine } from './NarrationFlow';
import QrModal from './QrModal';
import PassportCard from './PassportCard';
import TechnicalDetails from './TechnicalDetails';
import HowItWorks from './HowItWorks';
import ProofStrip from './ProofStrip';
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
  // 'returning' = World accepted a fresh proof from someone who already
  // verified; for this page that is still a proven human.
  const returning = worldPhase === 'returning';
  const humanDone = worldPhase === 'verified' || returning;
  const humanFailed = worldPhase === 'failed' || worldPhase === 'error';
  const evidenceUnavailable = evidenceError === 'not-deployed';

  const ensName = evidence?.ens?.sample?.name;
  // The mint receipt is the proof the name exists; the sample name carries no
  // addr record, so resolvedAddress is legitimately null.
  const ensLanded =
    !!evidence?.ens?.sample?.resolvedAddress ||
    receiptOk(evidence?.receipts, evidence?.ens?.sample?.txHash);
  const swapHash = evidence?.uniswap?.swapTx;
  const swapLanded = receiptOk(evidence?.receipts, swapHash) || (!!swapHash && !evidence?.receipts);

  const dataReady = humanDone && !evidenceLoading;

  // Real-state narration — every line is a direct read of usePassportFlow /
  // evidence, never a timer pretending progress.
  const lines: NarrationLine[] = useMemo(() => {
    if (!started) return [];
    const out: NarrationLine[] = [];

    if (worldPhase === 'starting' || worldPhase === 'awaiting') {
      out.push({ id: 'human', text: "Asking you to prove you're a real person…", state: 'active' });
    } else if (returning) {
      out.push({ id: 'human', text: "Welcome back — you're already verified", state: 'done' });
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
        out.push({ id: 'trading', text: 'Trades can require a verified human', state: 'done' });
      } else {
        out.push({ id: 'trading', text: 'Wiring the verified-human trade gate…', state: 'active' });
      }
    }

    return out;
  }, [
    started,
    worldPhase,
    returning,
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

  // Let the streamed narration lines actually finish revealing before the
  // result card swaps in — otherwise "Verified" / the agent name / "Protected
  // trading enabled" flash for a frame and get replaced. Hold ~600ms after
  // the last line lands (skipped for reduced motion, which wants the state
  // change to read instantly rather than animate).
  const narrationComplete = dataReady && lines.length > 0 && lines.every((l) => l.state === 'done');
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (!narrationComplete) {
      setShowResult(false);
      return;
    }
    if (reduceMotion) {
      setShowResult(true);
      return;
    }
    const t = setTimeout(() => setShowResult(true), 600);
    return () => clearTimeout(t);
  }, [narrationComplete, reduceMotion]);

  const resultReady = showResult;

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
              A human confirms they&rsquo;re real once, and the agent&rsquo;s identity carries that
              verification from then on.
            </p>
          </motion.div>

          <motion.div
            layout
            className={styles.flowStage}
            transition={{ duration: 0.5, ease: EASE }}
          >
            {resultReady ? (
              <PassportCard agentName={agentDisplayName} returning={returning} />
            ) : (
              <>
                {!started && (
                  <div className={styles.specimenWrap}>
                    <PassportCard agentName="your-agent.suwappu-agents.eth" specimen />
                    <span className={styles.specimenLabel}>Your agent&rsquo;s passport</span>
                  </div>
                )}

                <motion.button
                  layout="position"
                  type="button"
                  id="passport-cta"
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

        <HowItWorks />

        <ProofStrip evidence={evidence} evidenceUnavailable={evidenceUnavailable} />

        <TechnicalDetails
          status={status}
          statusError={statusError}
          statusLoading={statusLoading}
          nullifier={nullifier}
          evidence={evidence}
          evidenceError={evidenceError}
        />

        <section className={styles.closing}>
          <h2 className={styles.closingTitle}>Give your agent a passport of its own.</h2>
          <button
            type="button"
            className={styles.cta}
            onClick={() => {
              document.getElementById('passport-cta')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          >
            Get your agent a passport
          </button>
        </section>
      </main>

      <SummerFooter />
    </div>
  );
}
