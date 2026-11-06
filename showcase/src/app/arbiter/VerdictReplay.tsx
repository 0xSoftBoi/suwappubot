'use client';

import { useState } from 'react';
import CopyButton from './CopyButton';
import {
  ARBITER_WASM_HASH,
  CONTRACT,
  LIVE_TXS,
  NEARBLOCKS_TX,
  SCENARIOS,
  type Scenario,
} from './data';
import styles from './arbiter.module.css';

type Check = { label: string; ok: boolean };

/** Checks the enclave reports for a scenario, derived from the recorded verdict. */
function checksFor(s: Scenario): Check[] {
  const selfMerged = s.output.reason === 'self_merged';
  const checks: Check[] = [
    { label: 'merged', ok: true },
    { label: `author == ${s.input.author}`, ok: true },
    { label: 'merger != author', ok: !selfMerged },
  ];
  if (!selfMerged) checks.push({ label: 'merged_at <= deadline', ok: true });
  return checks;
}

function amountOf(s: Scenario) {
  const step = LIVE_TXS.find((t) => t.case === (s.tone === 'pass' ? 'pass' : 'fail') && t.kind === 'create');
  return step?.step.match(/([\d.]+ NEAR)/)?.[1] ?? '';
}

function short(h: string) {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

export default function VerdictReplay() {
  const [key, setKey] = useState<Scenario['key']>('pass');
  const s = SCENARIOS.find((x) => x.key === key)!;
  const pass = s.output.verdict === 'pass';
  const create = LIVE_TXS.find((t) => t.case === s.tone && t.kind === 'create')!;
  const resolve = LIVE_TXS.find((t) => t.case === s.tone && t.kind === 'resolve')!;
  const checks = checksFor(s);
  const prUrl = `https://github.com/${s.input.repo}/pull/${s.input.pr_number}`;

  const terms: [string, React.ReactNode][] = [
    ['Contract', <code key="c">{CONTRACT}</code>],
    ['Rubric', <code key="r">{s.input.context}</code>],
    ['Repository', <code key="rp">{s.input.repo}</code>],
    ['Pull request', <a key="pr" href={prUrl} target="_blank" rel="noopener noreferrer">#{s.input.pr_number}</a>],
    ['Author', <code key="a">{s.input.author}</code>],
    ['Amount', amountOf(s)],
  ];

  return (
    <div className={styles.win}>
      <div className={styles.titlebar}>
        <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
        <span className={styles.titleText}>Arbiter · NEAR testnet</span>
        <span className={styles.titleSpacer} aria-hidden="true" />
      </div>

      <div className={styles.winBody}>
        <nav className={styles.runList} aria-label="Recorded escrows">
          <p className={styles.listHead}>Escrows</p>
          {SCENARIOS.map((x) => (
            <button
              key={x.key}
              type="button"
              className={styles.runItem}
              aria-pressed={x.key === key}
              onClick={() => setKey(x.key)}
            >
              <span className={styles.runTop}>
                <i className={x.tone === 'pass' ? styles.dotOk : styles.dotNo} aria-hidden="true" />
                <span className={styles.runTitle}>PR #{x.input.pr_number}</span>
                <span className={styles.runState}>{x.tone === 'pass' ? 'Paid' : 'Open'}</span>
              </span>
              <span className={styles.runSub}>{x.title}</span>
            </button>
          ))}
        </nav>

        <div className={styles.pane} key={key} aria-live="polite">
          <header className={styles.paneHead}>
            <div>
              <h3 className={styles.paneTitle}>{s.title}</h3>
              <p className={styles.paneSub}>{s.blurb}</p>
            </div>
            <span className={pass ? styles.badgeOk : styles.badgeNo}>
              {pass ? 'Verdict: pass' : 'Verdict: fail'}
            </span>
          </header>

          <dl className={styles.terms}>
            {terms.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>

          <ol className={styles.log}>
            <li>
              <span className={styles.logK}>escrow created</span>
              <span className={styles.logV}>
                create_escrow · {amountOf(s)} locked · arbiter hash and rubric are contract constants
              </span>
            </li>
            <li>
              <span className={styles.logK}>arbiter requested</span>
              <span className={styles.logV}>resolve → OutLayer · wasm {short(ARBITER_WASM_HASH)}</span>
            </li>
            <li>
              <span className={styles.logK}>enclave fetched PR</span>
              <span className={styles.logV}>
                GET api.github.com/repos/{s.input.repo}/pulls/{s.input.pr_number}
                <span className={styles.checks}>
                  {checks.map((c) => (
                    <span key={c.label} className={c.ok ? styles.chkOk : styles.chkNo}>
                      <b aria-hidden="true">{c.ok ? '✓' : '✕'}</b>
                      {c.label}
                      <span className={styles.srOnly}>{c.ok ? ' true' : ' false'}</span>
                    </span>
                  ))}
                </span>
              </span>
            </li>
            <li>
              <span className={styles.logK}>verdict</span>
              <span className={styles.logV}>
                <span className={pass ? styles.okText : styles.noText}>{s.output.verdict}</span> · reason {s.output.reason}
              </span>
            </li>
            <li>
              <span className={styles.logK}>{pass ? 'settlement' : 'no transfer'}</span>
              <span className={styles.logV}>
                {s.payout}
                <span className={styles.logLine}>
                  arbiter_attestation … verdict={s.output.verdict} evidence_hash={short(s.output.evidence_hash)}
                </span>
              </span>
            </li>
          </ol>

          <div className={styles.hashes}>
            <div className={styles.hashRow}>
              <span>Evidence hash</span>
              <code title={s.output.evidence_hash}>{short(s.output.evidence_hash)}</code>
              <CopyButton value={s.output.evidence_hash} label="Copy evidence hash" />
            </div>
            <div className={styles.hashRow}>
              <span>Arbiter hash</span>
              <code title={ARBITER_WASM_HASH}>{short(ARBITER_WASM_HASH)}</code>
              <CopyButton value={ARBITER_WASM_HASH} label="Copy arbiter hash" />
            </div>
          </div>

          <footer className={styles.verify}>
            <span>Verify on chain</span>
            <span className={styles.verifyLinks}>
              <a href={NEARBLOCKS_TX(create.hash)} target="_blank" rel="noopener noreferrer">Create tx ↗</a>
              <a href={NEARBLOCKS_TX(resolve.hash)} target="_blank" rel="noopener noreferrer">Settlement tx ↗</a>
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
