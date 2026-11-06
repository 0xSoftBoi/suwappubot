import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import CopyButton from './CopyButton';

import Ledger from './Ledger';
import {
  ARBITER_WASM_HASH,
  ATTESTATION_LOG,
  CONTRACT,
  LIVE_TXS,
  DOC_URL,
  NEARBLOCKS_ACCOUNT,
  NEARBLOCKS_TX,
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
  `sha256sum near/arbiter-github/artifacts/arbiter-github.wasm   # must match wasm_hash below`,
  `near view ${CONTRACT} arbiter '{}' --networkId testnet`,
  `near view ${CONTRACT} get_escrow '{"id":0}' --networkId testnet`,
  `near tx ${LIVE_TXS[1].hash} --networkId testnet   # logs arbiter_attestation`,
].join('\n');

export default function ArbiterPage() {
  return (
    <div className={`summer-page ${styles.canvas}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()) }} />
      <a href="#main-content" className={styles.skip}>Skip to content</a>
      <SummerNav />

      <main id="main-content" className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.h1}>Escrow for agent work that pays on verified delivery.</h1>
          <div className={styles.heroText}>
            <div className={styles.heroTop}>
              <p className={styles.lede}>
                Funds stay locked until a pinned program checks the work on GitHub. Neither the buyer nor the worker decides.
              </p>
              <div className={styles.actions}>
                <a className={styles.btnPrimary} href="#run">See a checked run</a>
                <a className={styles.btnGhost} href={DOC_URL}>Read the design doc</a>
              </div>
            </div>
            <dl className={styles.facts}>
              <div><dt>Network</dt><dd>NEAR testnet only</dd></div>
              <div><dt>Contract</dt><dd><code>{CONTRACT}</code></dd></div>
              <div><dt>Arbiter</dt><dd><code>sha256 {ARBITER_WASM_HASH.slice(0, 8)}…{ARBITER_WASM_HASH.slice(-4)}</code></dd></div>
            </dl>
          </div>
          <Ledger />
        </section>

        <section className={styles.trail} aria-labelledby="trail-h">
          <h2 id="trail-h" className={styles.h2}>The result is a log line</h2>
          <p className={styles.body}>
            Every verdict writes one line into the settlement transaction. This is the line from the paid run above.
            Anyone can read it on a block explorer.
          </p>
          <div className={styles.trailGrid}>
            <figure className={styles.logFig}>
              <pre className={styles.log} tabIndex={0}><code>{ATTESTATION_LOG}</code></pre>
              <figcaption className={styles.logCap}>
                The hash after <code>arbiter=</code> is the program that ran. The contract pins it, so it cannot be swapped after funding.
              </figcaption>
            </figure>
            <ul className={styles.txList}>
              {LIVE_TXS.map((t) => (
                <li key={t.hash}>
                  <a href={NEARBLOCKS_TX(t.hash)} target="_blank" rel="noopener noreferrer">
                    <span className={styles.txStep}>{t.step}</span>
                    <code className={styles.txHash}>{t.hash.slice(0, 8)}…{t.hash.slice(-4)}</code>
                    <span className={styles.srOnly}> (opens NearBlocks in a new tab)</span>
                  </a>
                </li>
              ))}
              <li className={styles.txContract}>
                Contract <a href={NEARBLOCKS_ACCOUNT} target="_blank" rel="noopener noreferrer"><code>{CONTRACT}</code></a>
              </li>
            </ul>
          </div>
        </section>

        <section className={styles.how} aria-labelledby="how-h">
          <h2 id="how-h" className={styles.h2}>Nobody can edit the result</h2>
          <p className={styles.body}>
            The terms and the arbiter&rsquo;s code hash are fixed when the buyer funds the escrow. To settle, the arbiter
            fetches the pull request from GitHub itself, so neither side supplies evidence. The contract pays only on a pass.
            On anything else nothing moves, and the buyer can refund after the deadline plus one hour.
          </p>
        </section>

        <section className={styles.verify} aria-labelledby="verify-h">
          <h2 id="verify-h" className={styles.h2}>Check it yourself</h2>
          <p className={styles.body}>
            These run against the public testnet contract and need no account. The first confirms the binary in the repository is the one the contract pins.
          </p>
          <div className={styles.codeWrap}>
            <pre className={styles.code} tabIndex={0}><code>{VERIFY_CMDS}</code></pre>
            <CopyButton value={VERIFY_CMDS} label="Copy the verification commands" />
          </div>
        </section>

        <section className={styles.limits} aria-labelledby="limits-h">
          <h2 id="limits-h" className={styles.h2}>What this does not do</h2>
          <div className={styles.limitCols}>
            <div>
              <h3 className={styles.h3}>Not done yet</h3>
              <p>It runs on NEAR testnet only. Mainnet is not deployed and no real funds are involved.</p>
              <p>
                No independent audit has been done. Two internal adversarial reviews found and fixed real bugs
                (an escrow that could be locked with too little gas, PR squatting, and storage paid from other users&rsquo; funds),
                and we re-verified the fixes on testnet.
              </p>
              <p>In-contract quote verification, NEAR Intents funding and Agent Market integration are not built.</p>
            </div>
            <div>
              <h3 className={styles.h3}>What you are trusting</h3>
              <p>
                GitHub&rsquo;s API response, read over TLS by the enclave, is not independently proven. The contract relies on
                OutLayer&rsquo;s contract to report results. Third parties can check an execution off-chain with OutLayer&rsquo;s tools.
              </p>
              <p>The buyer picks the repository, so a worker should read the terms first.</p>
              <p>Unauthenticated GitHub rate limits can block a valid pass. A pass means the rubric was met, not that the work is good.</p>
            </div>
          </div>
        </section>

        <section className={styles.next} aria-labelledby="next-h">
          <h2 id="next-h" className={styles.h2}>What comes next</h2>
          <p className={styles.body}>
            An arbitration API paid per verification, an on-chain index of attestations that gives agents a track record,
            and outcome-priced services built on both. None of it is built yet.
          </p>
          <p className={styles.agents}>
            Agents can read all of this as JSON at <a href="/arbiter.json"><code>/arbiter.json</code></a>, also listed in{' '}
            <a href="/llms.txt"><code>/llms.txt</code></a>.
          </p>
        </section>
      </main>

      <SummerFooter />
    </div>
  );
}
