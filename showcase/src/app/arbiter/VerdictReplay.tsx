'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import CopyButton from './CopyButton';
import { ARBITER_WASM_HASH, CONTRACT, SCENARIOS, SPEC_ID, type Scenario } from './data';
import styles from './arbiter.module.css';

const STEPS = [
  { title: 'Escrow funded', detail: (s: Scenario) => `Buyer locks funds against rubric { ${s.input.context}, ${s.input.repo}#${s.input.pr_number}, author ${s.input.author} }.` },
  { title: 'Evidence submitted', detail: (s: Scenario) => `Signed GitHub webhook delivered: ${s.evidenceNote}.` },
  { title: 'Arbiter verifies', detail: (s: Scenario) => `HMAC checked, then rubric evaluated in the enclave: ${s.output.reason}.` },
  { title: 'Settlement', detail: (s: Scenario) => `${s.payout}. arbiter_attestation anchored on-chain.` },
];

export default function VerdictReplay() {
  const reduce = useReducedMotion();
  const [key, setKey] = useState<Scenario['key']>('pass');
  const [step, setStep] = useState(STEPS.length); // starts fully played: no empty first paint
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const scenario = SCENARIOS.find((s) => s.key === key)!;
  const done = step >= STEPS.length;

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);

  const run = useCallback(() => {
    clear();
    if (reduce) {
      setStep(STEPS.length);
      return;
    }
    setRunning(true);
    setStep(0);
    STEPS.forEach((_, n) => {
      timers.current.push(setTimeout(() => setStep(n + 1), 650 * (n + 1)));
    });
    timers.current.push(setTimeout(() => setRunning(false), 650 * STEPS.length));
  }, [reduce]);

  const pick = (k: Scenario['key']) => {
    if (k === key) return;
    setKey(k);
    // Replaying on every switch is what makes the three outcomes legible.
    setTimeout(run, 0);
  };

  const onKey = (e: React.KeyboardEvent, idx: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (idx + d + SCENARIOS.length) % SCENARIOS.length;
    tabs.current[n]?.focus();
    pick(SCENARIOS[n].key);
  };

  const outJson = JSON.stringify(scenario.output, null, 2);
  const inJson = JSON.stringify(
    {
      context: scenario.input.context,
      repo: scenario.input.repo,
      pr_number: scenario.input.pr_number,
      author: scenario.input.author,
      deadline_unix: scenario.input.deadline_unix,
      signature_hex: scenario.input.signature_hex,
      payload_b64: scenario.input.payload_b64.slice(0, 44) + '…',
    },
    null,
    2,
  );
  const isPass = scenario.output.verdict === 'pass';

  return (
    <div className={styles.replay} data-tone={scenario.tone}>
      <div className={styles.tabs} role="radiogroup" aria-label="Scenario">
        {SCENARIOS.map((s, idx) => (
          <button
            key={s.key}
            ref={(el) => { tabs.current[idx] = el; }}
            role="radio"
            aria-checked={s.key === key}
            tabIndex={s.key === key ? 0 : -1}
            type="button"
            className={styles.tab}
            data-tone={s.tone}
            onClick={() => pick(s.key)}
            onKeyDown={(e) => onKey(e, idx)}
          >
            <i aria-hidden="true" />
            <span>
              <b>{s.title}</b>
              <small>{s.blurb}</small>
            </span>
          </button>
        ))}
      </div>

      <div className={styles.replayGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.kicker}>Pipeline</span>
            <button type="button" className={styles.runBtn} onClick={run} disabled={running}>
              {running ? 'Running…' : done ? 'Replay verdict' : 'Run verdict'}
            </button>
          </div>
          <ol className={styles.steps} aria-live="polite">
            {STEPS.map((s, n) => {
              const state = step > n ? 'done' : step === n && running ? 'active' : 'idle';
              const failed = n === STEPS.length - 1 && !isPass && state === 'done';
              return (
                <li key={s.title} className={styles.step} data-state={state} data-failed={failed || undefined}>
                  <span className={styles.stepDot} aria-hidden="true">{state === 'done' ? (failed ? '×' : '✓') : n + 1}</span>
                  <span className={styles.stepBody}>
                    <b>{s.title}</b>
                    <small>{s.detail(scenario)}</small>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className={styles.jsonGrid}>
            <div>
              <span className={styles.kicker}>Rubric &amp; evidence in</span>
              <pre className={styles.code}>{inJson}</pre>
            </div>
            <div>
              <div className={styles.rowBetween}>
                <span className={styles.kicker}>Verdict out (recorded, byte-exact)</span>
                <CopyButton value={outJson} label="Copy verdict JSON" />
              </div>
              <pre className={styles.code} data-reveal={done || undefined}>{outJson}</pre>
            </div>
          </div>
        </div>

        <figure className={styles.cred} data-ready={done} data-tone={scenario.tone} aria-label="Signed work attestation">
          <div className={styles.credSheen} aria-hidden="true" />
          <header className={styles.credHead}>
            <svg viewBox="0 0 40 40" width="38" height="38" aria-hidden="true">
              <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 3" />
              <circle cx="20" cy="20" r="11.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d={isPass ? 'M14 20.5l4.2 4.2L26.5 15' : 'M15 15l10 10M25 15L15 25'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <span className={styles.kicker}>Work attestation</span>
              <b className={styles.credSpec}>{SPEC_ID}</b>
            </div>
            <span className={styles.credVerdict}>{scenario.output.verdict.toUpperCase()}</span>
          </header>

          <dl className={styles.credRows}>
            <div><dt>Rubric</dt><dd>{scenario.input.context} · {scenario.input.repo}#{scenario.input.pr_number} · author {scenario.input.author}</dd></div>
            <div><dt>Reason</dt><dd>{scenario.output.reason}</dd></div>
            <div><dt>Contract</dt><dd>{CONTRACT}</dd></div>
            <div>
              <dt>Arbiter code hash</dt>
              <dd className={styles.hashRow}><code>{ARBITER_WASM_HASH}</code><CopyButton value={ARBITER_WASM_HASH} label="Copy arbiter code hash" /></dd>
            </div>
            <div>
              <dt>Evidence hash</dt>
              <dd className={styles.hashRow}><code>{scenario.output.evidence_hash}</code><CopyButton value={scenario.output.evidence_hash} label="Copy evidence hash" /></dd>
            </div>
            <div><dt>Enclave</dt><dd>Intel TDX · NEAR OutLayer</dd></div>
            <div><dt>Payout</dt><dd>{scenario.payout}</dd></div>
          </dl>
          <figcaption className={styles.credFoot}>
            Replay of recorded arbiter-wasm output. The pass and wrong-author cases were also executed live on NEAR testnet; see the ledger below.
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
