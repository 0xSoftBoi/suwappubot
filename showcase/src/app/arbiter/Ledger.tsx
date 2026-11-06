'use client';

import { useState } from 'react';
import CopyButton from './CopyButton';
import { SCENARIOS, NEARBLOCKS_TX } from './data';
import styles from './arbiter.module.css';

/**
 * The run ledger: two real runs from NEAR testnet, shown as the five checks the arbiter
 * evaluated, in order, plus the result. All values come from data.ts (real outputs).
 * Motion: switching runs re-plays the checks in sequence, which shows the order they run in.
 */
export default function Ledger() {
  const [i, setI] = useState(0);
  const s = SCENARIOS[i];
  const held = s.result === 'Held';

  return (
    <div className={styles.ledger} id="run">
      <div className={styles.tabs} role="tablist" aria-label="Choose a run">
        {SCENARIOS.map((sc, idx) => (
          <button
            key={sc.key}
            role="tab"
            type="button"
            aria-selected={idx === i}
            className={`${styles.tab} ${idx === i ? styles.tabOn : ''}`}
            onClick={() => setI(idx)}
          >
            {sc.tab}
          </button>
        ))}
      </div>

      {/* key remounts the panel so the check sequence replays on every switch */}
      <div key={s.key} className={styles.panel} role="tabpanel">
        <p className={`${styles.result} ${held ? styles.resultHeld : ''}`}>{s.result}</p>
        <p className={styles.summary}>{s.summary}</p>

        <ol className={styles.checks}>
          {s.checks.map((c, n) => (
            <li
              key={c.rule}
              className={`${styles.check} ${c.ok ? '' : styles.checkNo}`}
              style={{ ['--n' as string]: n }}
            >
              <span className={styles.checkVerdict}>{c.ok ? 'Yes' : 'No'}</span>
              <span className={styles.checkRule}>{c.rule}</span>
              <span className={styles.checkFound}>{c.found}</span>
            </li>
          ))}
        </ol>

        <dl className={styles.meta}>
          <div>
            <dt>Evidence hash</dt>
            <dd>
              <code>{s.output.evidence_hash.slice(0, 10)}…{s.output.evidence_hash.slice(-6)}</code>
              <CopyButton value={s.output.evidence_hash} label="Copy evidence hash" />
            </dd>
          </div>
          <div>
            <dt>{s.settlement}</dt>
            <dd>
              <a href={NEARBLOCKS_TX(s.resolveTx)} target="_blank" rel="noopener noreferrer">
                <code>{s.resolveTx.slice(0, 8)}…{s.resolveTx.slice(-4)}</code>
                <span className={styles.srOnly}> (opens NearBlocks in a new tab)</span>
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
