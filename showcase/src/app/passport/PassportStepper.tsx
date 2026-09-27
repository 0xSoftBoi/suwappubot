'use client';

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import QrModal from './QrModal';
import { HOOK_ADDRESS, etherscanAddress, etherscanTx, ensAppUrl } from './api';
import type { usePassportFlow } from './usePassportFlow';
import s from './stepper.module.css';

type Flow = ReturnType<typeof usePassportFlow>;
type StepState = 'locked' | 'active' | 'busy' | 'done' | 'failed';

const EASE = [0.22, 1, 0.36, 1] as const;
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

/** Deterministic two-stop gradient from an address, so each agent has a face. */
function agentGradient(addr: string): string {
  const h = parseInt(addr.slice(2, 8) || '0', 16);
  const a = h % 360;
  const b = (a + 40 + (h % 80)) % 360;
  return `linear-gradient(135deg, hsl(${a} 70% 62%), hsl(${b} 75% 48%))`;
}

/**
 * The three-step passport demo as one focused stage: a stepper, the active
 * step expanded, finished steps collapsed to one-line results, and a payoff
 * card at the end. Every state is read from usePassportFlow — nothing here
 * advances on a timer.
 */
export default function PassportStepper({ flow }: { flow: Flow }) {
  const reduceMotion = useReducedMotion();
  const {
    wallet,
    setWallet,
    newWallet,
    swaps,
    attemptSwap,
    verifyPhase,
    verifyError,
    start,
    verified,
    humanVerified,
    beginVerification,
    cancelVerification,
    walletSwitchedFrom,
  } = flow;
  const [editing, setEditing] = useState(false);

  const pre = swaps.pre;
  const post = swaps.post;
  const verifyBusy = verifyPhase === 'starting' || verifyPhase === 'pending' || verifyPhase === 'provisioning';
  const verifyFailed = verifyPhase === 'failed' || verifyPhase === 'error';
  const passport =
    verified && (verified.status === 'ready' || verified.status === 'existing') ? verified : null;
  const returning = verifyPhase === 'existing';

  const step1Done = pre.phase === 'blocked' || pre.phase === 'executed';
  const s1: StepState =
    pre.phase === 'checking' || pre.phase === 'submitted' ? 'busy' : step1Done ? 'done' : pre.phase === 'failed' ? 'failed' : 'active';
  const s2: StepState = !step1Done
    ? 'locked'
    : humanVerified
      ? 'done'
      : verifyBusy
        ? 'busy'
        : verifyFailed
          ? 'failed'
          : 'active';
  const s3: StepState = !humanVerified
    ? 'locked'
    : post.phase === 'executed'
      ? 'done'
      : post.phase === 'checking' || post.phase === 'submitted'
        ? 'busy'
        : post.phase === 'failed' || post.phase === 'blocked'
          ? 'failed'
          : 'active';
  const current = s3 !== 'locked' ? 3 : s2 !== 'locked' ? 2 : 1;
  const finished = s3 === 'done';

  const executedJob = post.job?.status === 'executed' ? post.job : null;

  const steps: { n: 1 | 2 | 3; title: string; state: StepState; summary: React.ReactNode }[] = [
    {
      n: 1,
      title: 'Try a trade',
      state: s1,
      summary:
        pre.phase === 'blocked' ? (
          <span className={s.bad}>Blocked by the hook · no gas spent</span>
        ) : pre.phase === 'executed' ? (
          <span className={s.good}>Went through — this wallet already has a passport</span>
        ) : null,
    },
    {
      n: 2,
      title: 'Prove you’re human',
      state: s2,
      summary: passport ? (
        <span className={s.good}>
          {returning ? 'Welcome back' : 'Verified'} ·{' '}
          <a href={ensAppUrl(passport.ens.name)} target="_blank" rel="noopener noreferrer">
            {passport.ens.name}
          </a>
        </span>
      ) : null,
    },
    {
      n: 3,
      title: 'Trade with the passport',
      state: s3,
      summary: executedJob ? (
        <span className={s.good}>
          Executed
          {executedJob.blockNumber ? ` · block ${executedJob.blockNumber.toLocaleString()}` : ''}
          {executedJob.txHash && (
            <>
              {' '}
              ·{' '}
              <a href={etherscanTx(executedJob.txHash)} target="_blank" rel="noopener noreferrer">
                view tx ↗
              </a>
            </>
          )}
        </span>
      ) : null,
    },
  ];

  const fade = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -6 },
      };

  return (
    <div className={s.stage}>
      {/* Agent identity */}
      <div className={s.agent}>
        <span className={s.avatar} style={{ background: agentGradient(wallet) }} aria-hidden="true" />
        <div className={s.agentText}>
          <span className={s.agentLabel}>{passport ? passport.ens.name : 'Your agent'}</span>
          {editing ? (
            <input
              className={s.agentInput}
              value={wallet}
              onChange={(e) => setWallet(e.target.value.trim())}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
              spellCheck={false}
              autoFocus
              aria-label="Agent wallet address"
            />
          ) : (
            <button type="button" className={s.agentAddr} onClick={() => setEditing(true)} title="Edit wallet">
              {short(wallet)} <span aria-hidden="true">✎</span>
            </button>
          )}
        </div>
        <button type="button" className={s.ghostBtn} onClick={newWallet}>
          New agent
        </button>
      </div>

      {/* Payoff */}
      <AnimatePresence>
        {finished && passport && executedJob && (
          <motion.div className={s.passport} {...fade} transition={{ duration: 0.5, ease: EASE }}>
            <span className={s.kicker}>{returning ? 'Welcome back — passport active' : 'Passport issued'}</span>
            <a className={s.passportName} href={ensAppUrl(passport.ens.name)} target="_blank" rel="noopener noreferrer">
              {passport.ens.name.split('.')[0]}
              <span>.{passport.ens.name.split('.').slice(1).join('.')}</span>
            </a>
            <div className={s.chips}>
              <span className={s.chip}>✓ Verified human owner</span>
              <span className={s.chip}>✓ Allowed by the swap hook</span>
            </div>
            <div className={s.beforeAfter}>
              <div className={s.ba} data-tone="bad">
                <span className={s.baLabel}>Before</span>
                <span>Blocked · 0 gas</span>
              </div>
              <span className={s.baArrow} aria-hidden="true">→</span>
              <div className={s.ba} data-tone="good">
                <span className={s.baLabel}>After</span>
                <span>
                  Executed
                  {executedJob.blockNumber ? ` · block ${executedJob.blockNumber.toLocaleString()}` : ''}
                </span>
              </div>
            </div>
            {walletSwitchedFrom && (
              <p className={s.note}>
                One human, one passport: yours lives on {short(wallet)}, so the agent switched to it. The
                fresh wallet {short(walletSwitchedFrom)} stays blocked.
              </p>
            )}
            <div className={s.links}>
              {executedJob.txHash && (
                <a href={etherscanTx(executedJob.txHash)} target="_blank" rel="noopener noreferrer">
                  Swap transaction ↗
                </a>
              )}
              {passport.ens.txHash && (
                <a href={etherscanTx(passport.ens.txHash)} target="_blank" rel="noopener noreferrer">
                  Name mint ↗
                </a>
              )}
              {executedJob.executedBy && (
                <a href={etherscanAddress(executedJob.executedBy)} target="_blank" rel="noopener noreferrer">
                  Relayer {short(executedJob.executedBy)} ↗
                </a>
              )}
            </div>
            <button type="button" className={s.ghostBtn} onClick={newWallet}>
              Run it again with a new agent
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Steps */}
      <div className={s.steps}>
        {steps.map((st) => {
          const open = st.n === current && !finished;
          return (
            <motion.section
              key={st.n}
              layout={!reduceMotion}
              className={s.step}
              data-state={st.state}
              data-open={open || undefined}
              transition={{ duration: 0.35, ease: EASE }}
            >
              <header className={s.stepHead}>
                <span className={s.stepNum}>{st.state === 'done' ? '✓' : st.state === 'failed' ? '!' : st.n}</span>
                <span className={s.stepTitle}>{st.title}</span>
                {!open && st.summary && <span className={s.stepSummary}>{st.summary}</span>}
                {!open && st.state === 'locked' && <span className={s.stepSummary}>Locked</span>}
              </header>

              <AnimatePresence initial={false} mode="wait">
                {open && (
                  <motion.div
                    key={`${st.n}-${st.state}`}
                    className={s.stepBody}
                    {...fade}
                    transition={{ duration: 0.3, ease: EASE }}
                  >
                    {st.n === 1 && (
                      <>
                        <p className={s.copy}>
                          Your agent tries to trade on a Uniswap v4 pool guarded by a World ID hook. It
                          doesn&rsquo;t have a passport yet.
                        </p>
                        {pre.phase === 'failed' && <p className={s.error}>{pre.error}</p>}
                        <button
                          type="button"
                          className={s.cta}
                          onClick={() => attemptSwap('pre')}
                          disabled={st.state === 'busy'}
                        >
                          {st.state === 'busy' ? <Spinner label="Asking the hook…" /> : 'Send a test trade'}
                        </button>
                      </>
                    )}

                    {st.n === 2 && (
                      <>
                        <Result tone="bad" title="Blocked by the hook" link={{ href: etherscanAddress(HOOK_ADDRESS), label: 'hook ↗' }}>
                          The hook found no passport for {short(wallet)} and refused it during simulation. No
                          transaction was sent.
                        </Result>
                        <p className={s.copy}>
                          Prove a real person stands behind this agent. One human, one passport — World ID
                          shares no personal data.
                        </p>
                        {verifyPhase === 'provisioning' ? (
                          <ul className={s.progress}>
                            <li data-done="true">Human verified</li>
                            <li>
                              <Spinner label="Minting the agent's name and allowlisting it on the hook…" />
                            </li>
                          </ul>
                        ) : (
                          <>
                            {verifyFailed && <p className={s.error}>{verifyError || 'Verification failed.'}</p>}
                            <button
                              type="button"
                              className={s.cta}
                              onClick={() => (verifyBusy ? cancelVerification() : beginVerification())}
                            >
                              {verifyBusy ? 'Waiting for World App… (cancel)' : verifyFailed ? 'Try again' : 'Verify with World ID'}
                            </button>
                          </>
                        )}
                      </>
                    )}

                    {st.n === 3 && (
                      <>
                        {passport && (
                          <Result tone="good" title={returning ? 'Welcome back' : 'Passport issued'}>
                            {returning && walletSwitchedFrom
                              ? `Your passport lives on ${short(wallet)}, so the agent switched to it.`
                              : `${passport.ens.name} now belongs to this agent, and the hook allowlists it.`}
                          </Result>
                        )}
                        <p className={s.copy}>
                          Same pool, same hook. This time the hook finds a verified human behind the wallet.
                        </p>
                        {post.phase === 'blocked' && (
                          <p className={s.error}>
                            Still blocked{post.result?.status === 'blocked' ? ` — ${post.result.reason}` : ''}.
                          </p>
                        )}
                        {post.phase === 'failed' && <p className={s.error}>{post.error}</p>}
                        <button
                          type="button"
                          className={s.cta}
                          onClick={() => attemptSwap('post')}
                          disabled={st.state === 'busy'}
                        >
                          {post.phase === 'checking' ? (
                            <Spinner label="Asking the hook…" />
                          ) : post.phase === 'submitted' ? (
                            <Spinner label="Allowed — sending the swap…" />
                          ) : (
                            'Trade with the passport'
                          )}
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.section>
          );
        })}
      </div>

      <QrModal
        open={verifyPhase === 'starting' || verifyPhase === 'pending'}
        connectorURI={start?.connectorURI ?? null}
        onClose={cancelVerification}
        simulatorUrl={start?.simulatorUrl}
      />
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <span className={s.spin}>
      <span className={s.spinner} aria-hidden="true" />
      {label}
    </span>
  );
}

function Result({
  tone,
  title,
  children,
  link,
}: {
  tone: 'good' | 'bad';
  title: string;
  children: React.ReactNode;
  link?: { href: string; label: string };
}) {
  return (
    <div className={s.result} data-tone={tone}>
      <span className={s.resultIcon} aria-hidden="true">{tone === 'good' ? '✓' : '✕'}</span>
      <div>
        <span className={s.resultTitle}>
          {title}
          {link && (
            <a href={link.href} target="_blank" rel="noopener noreferrer">
              {link.label}
            </a>
          )}
        </span>
        <span className={s.resultBody}>{children}</span>
      </div>
    </div>
  );
}
