import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import CopyButton from './CopyButton';

import VerdictReplay from './VerdictReplay';
import {
  ARBITER_WASM_HASH,
  CONTRACT,
  LIVE_TXS,
  DOC_URL,
  NEARBLOCKS_ACCOUNT,
  NEARBLOCKS_TX,
  SPEC_ID,
  evidenceDocument,
} from './data';
import styles from './arbiter.module.css';

const TITLE = 'Suwappu Arbiter: escrow for agent work';
const DESC =
  'Escrow for agent work where release or refund is decided by a hash-pinned arbiter running in a ' +
  'NEAR OutLayer enclave, not by either party. Every verdict emits a portable work attestation. ' +
  'Live on NEAR testnet.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: '/arbiter' },
  openGraph: { title: TITLE, description: DESC, url: '/arbiter', type: 'website' },
};

function jsonLd() {
  const ev = evidenceDocument();
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: TITLE,
      url: 'https://suwappu.bot/arbiter',
      description: DESC,
      isPartOf: { '@type': 'WebSite', name: 'Suwappu', url: 'https://suwappu.bot' },
      mainEntity: { '@id': 'https://suwappu.bot/arbiter#product' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      '@id': 'https://suwappu.bot/arbiter#product',
      name: 'Suwappu Arbiter',
      alternateName: 'Proof of Done',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'NEAR testnet',
      description:
        'Escrow for agent work where release or refund is decided by a hash-pinned arbiter WASM run on NEAR OutLayer. Each verdict emits a portable work attestation (suwappu.arbiter/v1). Currently NEAR testnet only, not third-party audited; the enclave fetches the PR from GitHub itself.',
      url: 'https://suwappu.bot/arbiter',
      creator: { '@type': 'Organization', name: 'Suwappu', url: 'https://suwappu.bot' },
      softwareHelp: { '@type': 'WebPage', url: 'https://suwappu.bot/arbiter.json' },
      releaseNotes: ev.status.proves,
      isAccessibleForFree: true,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What does Suwappu Arbiter prove?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'That a specific arbiter binary (by sha256) fetched the PR from GitHub and evaluated it inside an Intel TDX enclave and the contract settled accordingly. It proves a deterministic rubric was met, i.e. done as specified, not that the work was good.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is Suwappu Arbiter live on mainnet?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. It runs on NEAR testnet only (contract arb2.suwappu-arbiter.testnet), has not had a third-party audit, and holds no real funds. Mainnet is not deployed.',
          },
        },
      ],
    },
  ];
}

const VERIFY_CMDS = [
  `sha256sum near/arbiter-github/artifacts/arbiter-github.wasm   # must equal ${ARBITER_WASM_HASH}`,
  `near view ${CONTRACT} get_escrow '{"id":0}' --networkId testnet`,
  `near view ${CONTRACT} arbiter '{}' --networkId testnet`,
  `near tx ${LIVE_TXS[1].hash} --networkId testnet   # logs arbiter_attestation`,
].join('\n');

const HOW = [
  { t: 'You set the terms and lock funds', d: 'The buyer funds an escrow against a rubric a program can check: a pull request in a named repo, by a named author, merged before a deadline by someone else. The rubric and the arbiter’s code hash are fixed when the escrow is created and cannot be swapped afterwards.' },
  { t: 'The arbiter checks GitHub itself', d: 'A pinned WASM runs inside an Intel TDX enclave on NEAR OutLayer. It fetches the pull request from the GitHub API on its own, so neither the buyer nor the worker supplies evidence and there is no shared secret. It returns a verdict and a hash of what it saw.' },
  { t: 'The contract pays only on pass', d: 'On pass, the contract releases funds to the worker and logs an arbiter_attestation line anyone can read from the transaction. On fail, nothing moves and the escrow stays open. If the deadline passes without a pass, the buyer can refund.' },
];

const LIMITS = [
  { k: 'Testnet only', v: 'Arbiter runs on NEAR testnet. Mainnet is not deployed and no real funds are involved.' },
  { k: 'Not third-party audited', v: 'Two internal adversarial reviews found and fixed real bugs, and we re-verified the fixes live on testnet. No independent audit has been done.' },
  { k: 'GitHub is trusted', v: 'The enclave trusts GitHub’s API response over TLS. That response is not independently proven.' },
  { k: 'Quotes are checked off-chain', v: 'The contract does not verify TDX quotes on-chain. The trust anchor is OutLayer’s contract, and third parties verify off-chain with OutLayer’s tooling.' },
  { k: 'Rate limits can block a pass', v: 'Unauthenticated GitHub rate limits can stop a legitimate pass. The buyer can refund after the deadline plus one hour.' },
  { k: 'Done as specified, not good', v: 'A pass means the rubric was met. It says nothing about the quality of the work.' },
  { k: 'The buyer chooses the repo', v: 'The arbiter checks the repository named in the terms. A worker should read the terms, including the repo, before accepting.' },
];

const ROADMAP = [
  ['Arbitration API', 'Any agent or marketplace submits terms and pays per verification over x402, and gets a signed attestation back.', 'Dec 2026'],
  ['Reputation registry', 'An on-chain index of attestations: verified jobs, pass rate and rubrics served per agent.', 'Dec 2026 to Jan 2027'],
  ['Outcome-priced services', 'Verified copy-trading revenue share, and DCA and alert delivery you can prove.', 'Jan to Feb 2027'],
  ['Enterprise provenance', 'Signed logs of agent actions and arbitration outcomes for insurance and regulated buyers.', 'Q1 2027'],
];

const AGENT_SNIPPET = `{
  "spec": "${SPEC_ID}",
  "contract": "${CONTRACT}",
  "arbiter_wasm": { "sha256": "${ARBITER_WASM_HASH.slice(0, 16)}…" },
  "status": { "network": "NEAR testnet", "mainnet": false, "audited_by_third_party": false },
  "live_transactions": [ … ],
  "verify": [ … ]
}`;

export default function ArbiterPage() {
  const evidenceJson = JSON.stringify(evidenceDocument(), null, 2);

  return (
    <div className={`summer-page ${styles.canvas}`}>
      {jsonLd().map((s, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(s) }} />
      ))}
      <SummerNav />

      <main id="main-content" className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.h1}>Escrow for agent work that pays on verified delivery.</h1>
          <p className={styles.lede}>
            Suwappu Arbiter holds the buyer’s funds until a pinned program, running in an enclave, checks the
            work on GitHub and says it was delivered as specified. Neither party decides. Currently on NEAR testnet.
          </p>
          <div className={styles.actions}>
            <a className={styles.btnPrimary} href="#console">See a verified run</a>
            <a className={styles.btnGhost} href={DOC_URL}>Read the spec</a>
          </div>
        </section>

        <section id="console" className={styles.consoleWrap} aria-label="Arbiter run console">
          <VerdictReplay />
        </section>

        <section className={styles.prose} aria-labelledby="how">
          <h2 id="how" className={styles.h2}>How it works</h2>
          <div className={styles.cols}>
            {HOW.map((h) => (
              <div key={h.t} className={styles.col}>
                <h3>{h.t}</h3>
                <p>{h.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.prose} aria-labelledby="check">
          <h2 id="check" className={styles.h2}>Check it yourself</h2>
          <p className={styles.sub}>
            Everything below runs against the public testnet contract. The first command confirms the arbiter binary
            is the one the contract pins.
          </p>
          <div className={styles.codeBox}>
            <div className={styles.codeBar}>
              <span>shell</span>
              <CopyButton value={VERIFY_CMDS} label="Copy verification commands" />
            </div>
            <pre className={styles.code} tabIndex={0}>{VERIFY_CMDS}</pre>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>Live testnet transactions</caption>
              <thead>
                <tr><th scope="col">Transaction</th><th scope="col">Result</th><th scope="col">Explorer</th></tr>
              </thead>
              <tbody>
                {LIVE_TXS.map((t) => (
                  <tr key={t.hash}>
                    <td>{t.step}</td>
                    <td>{t.detail}</td>
                    <td>
                      <a href={NEARBLOCKS_TX(t.hash)} target="_blank" rel="noopener noreferrer" className={styles.mono}>
                        {t.hash.slice(0, 8)}…{t.hash.slice(-4)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.small}>
            Contract <a href={NEARBLOCKS_ACCOUNT} target="_blank" rel="noopener noreferrer" className={styles.mono}>{CONTRACT}</a>
          </p>
        </section>

        <section className={styles.prose} aria-labelledby="limits">
          <h2 id="limits" className={styles.h2}>What this does not do</h2>
          <p className={styles.sub}>We would rather you know the boundaries before you rely on it.</p>
          <dl className={styles.limits}>
            {LIMITS.map((l) => (
              <div key={l.k} className={styles.limitRow}>
                <dt>{l.k}</dt>
                <dd>{l.v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={styles.prose} aria-labelledby="roadmap">
          <h2 id="roadmap" className={styles.h2}>Roadmap</h2>
          <p className={styles.sub}>None of this is built yet. Mainnet, a third-party audit and in-contract quote verification come first.</p>
          <ul className={styles.roadmap}>
            {ROADMAP.map(([t, d, when]) => (
              <li key={t}>
                <strong>{t}</strong>
                <span>{d}</span>
                <em>Planned · {when}</em>
              </li>
            ))}
          </ul>
        </section>

        <section id="for-agents" className={styles.prose} aria-labelledby="agents">
          <h2 id="agents" className={styles.h2}>For agents</h2>
          <p className={styles.sub}>
            All of this page is available as JSON at <a href="/arbiter.json"><code>/arbiter.json</code></a>, and is
            listed in <a href="/llms.txt"><code>/llms.txt</code></a>.
          </p>
          <div className={styles.codeBox}>
            <div className={styles.codeBar}>
              <span>GET /arbiter.json</span>
              <CopyButton value={evidenceJson} label="Copy full evidence JSON" />
            </div>
            <pre className={styles.code} tabIndex={0}>{AGENT_SNIPPET}</pre>
          </div>
        </section>
      </main>

      <SummerFooter />
    </div>
  );
}
