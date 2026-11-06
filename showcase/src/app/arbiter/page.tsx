import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import CopyButton from './CopyButton';
import HeroPipeline from './HeroPipeline';
import VerdictReplay from './VerdictReplay';
import {
  ARBITER_WASM_HASH,
  CONTRACT,
  LIVE_TXS,
  NEARBLOCKS_ACCOUNT,
  NEARBLOCKS_TX,
  SPEC_ID,
  evidenceDocument,
} from './data';
import styles from './arbiter.module.css';

const TITLE = 'Arbiter: Proof of Done for agent work';
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

const VERIFY_CMDS = [
  { n: '01', what: 'Pin the arbiter binary', cmd: 'sha256sum near/arbiter-github/artifacts/arbiter-github.wasm', note: `must equal ${ARBITER_WASM_HASH.slice(0, 12)}…` },
  { n: '02', what: 'Read the escrow terms and status', cmd: `near view ${CONTRACT} get_escrow '{"id":0}' --networkId testnet`, note: 'terms, worker, amount, status' },
  { n: '03', what: 'Read the pinned arbiter', cmd: `near view ${CONTRACT} arbiter '{}' --networkId testnet`, note: 'code hash and URL are contract constants' },
  { n: '04', what: 'Read the attestation from the settlement tx', cmd: `near tx ${LIVE_TXS[1].hash} --networkId testnet`, note: 'logs the arbiter_attestation line' },
];

const FLOW = [
  { t: 'Lock', d: 'The buyer funds an escrow against a machine-checkable rubric. The rubric and the arbiter’s code hash are pinned at creation and cannot be swapped later.' },
  { t: 'Deliver', d: 'The worker agent ships and gets the pull request merged. Neither party submits evidence.' },
  { t: 'Judge', d: 'A hash-pinned WASM runs inside an Intel TDX enclave on NEAR OutLayer. It fetches the PR from the GitHub API itself and checks merged, author, repo, merged_at <= deadline and merger != author. No shared secret.' },
  { t: 'Settle', d: 'The contract moves funds only on that verdict, and logs an arbiter_attestation anyone can read from the transaction.' },
];

const CONTRAST = [
  ['A platform employee reads screenshots and decides', 'A fixed, public program fetches and checks the evidence itself'],
  ['Disputes take days and depend on who argues better', 'Verdict returns in one call, same input gives same output'],
  ['The rules can change after the money is in', 'Rubric and arbiter hash are pinned on-chain at creation'],
  ['Nothing portable comes out of a settled job', 'Every verdict emits a hash-anchored attestation'],
  ['You trust the operator’s honesty', 'You check three hashes yourself'],
];

const SPEC_FIELDS: [string, string][] = [
  ['fmt', `"${SPEC_ID}"`],
  ['subject', '{ kind: "milestone", contract, escrow_id }'],
  ['parties', '{ buyer, worker }'],
  ['rubric', '{ context, repo, pr_number, author, deadline_unix, terms_hash }'],
  ['verdict', '{ verdict, reason, evidence_hash, enclave, arbiter_wasm_hash }'],
  ['settlement', '{ status, amount_yocto, chain, tx_hash }'],
  ['issued_at_block', 'u64'],
];

const ROADMAP = [
  { when: 'Dec 2026', t: 'Arbitration API', d: 'Any agent or marketplace submits terms and evidence, pays per verification over x402, and gets a signed attestation back.' },
  { when: 'Dec 2026 to Jan 2027', t: 'Reputation registry', d: 'An on-chain attestation index becomes an agent résumé: verified jobs, pass rate, rubrics served.' },
  { when: 'Jan to Feb 2027', t: 'Outcome-priced services', d: 'Verified copy-trading revenue share, DCA and alert delivery you can prove, attestation-filtered agent marketplaces.' },
  { when: 'Q1 2027', t: 'Enterprise provenance', d: 'Signed logs of agent actions and arbitration outcomes for insurance, SOC 2 and regulated buyers.' },
];

const LIMITS = [
  { k: 'Network', v: 'NEAR testnet only. Mainnet is not deployed.' },
  { k: 'Audit', v: 'Not audited by a third party. Two internal adversarial reviews were done; findings were fixed and re-verified live.' },
  { k: 'GitHub trust', v: 'The enclave trusts GitHub’s API response over TLS; it is not independently proven. The buyer chooses the repo.' },
  { k: 'Quotes', v: 'The contract does not verify TDX quotes on-chain. The trust anchor is OutLayer’s contract; third parties verify off-chain with OutLayer’s tooling.' },
  { k: 'Rate limits', v: 'Unauthenticated GitHub rate limits can block a pass. The buyer can then refund after the deadline plus one hour.' },
  { k: 'Scope', v: 'It proves delivered as specified, not that the work was good.' },
  { k: 'Not shipped', v: 'Mainnet, third-party audit, in-contract TDX quote verification, NEAR Intents funding, Agent Market integration, LLM-judged rubrics.' },
];

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

export default function ArbiterPage() {
  const evidenceJson = JSON.stringify(evidenceDocument(), null, 2);

  return (
    <div className={`summer-page ${styles.canvas}`}>
      {jsonLd().map((s, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(s) }} />
      ))}
      <SummerNav />

      <main id="main-content" className={styles.main}>
        {/* ───────── Hero ───────── */}
        <section className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden="true" />
          <span className={styles.chip}><i aria-hidden="true" /> Live on NEAR testnet</span>
          <h1 className={styles.h1}>
            Agents that can&rsquo;t prove delivery <em>don&rsquo;t get paid.</em>
          </h1>
          <p className={styles.lede}>
            Suwappu Arbiter is escrow for agent work. A hash-pinned program in a sealed enclave
            decides release or refund, not either party, and every verdict leaves a portable attestation.
          </p>
          <div className={styles.ctas}>
            <a className={styles.ctaPrimary} href="#verdict">Run the live verdict <span aria-hidden="true">↓</span></a>
            <a className={styles.ctaGhost} href={NEARBLOCKS_ACCOUNT} target="_blank" rel="noopener noreferrer">
              Verify on NEAR testnet <span aria-hidden="true">↗</span>
            </a>
          </div>
          <HeroPipeline />
          <ul className={styles.stats} aria-label="At a glance">
            <li><b>2</b><span>rubric outcomes replayed</span></li>
            <li><b>4</b><span>testnet transactions</span></li>
            <li><b>1</b><span>pinned arbiter hash</span></li>
            <li><b>0</b><span>humans in the verdict path</span></li>
          </ul>
        </section>

        {/* ───────── Replay ───────── */}
        <section id="verdict" className={styles.section}>
          <header className={styles.sectionHead}>
            <span className={styles.kicker}>Verdict replay</span>
            <h2>Watch a verdict get made.</h2>
            <p>Two real outcomes recorded from the v2.1 arbiter on testnet. Pick one, run it, read the attestation it emits. Hashes below are copied byte for byte.</p>
          </header>
          <VerdictReplay />
        </section>

        {/* ───────── How it works ───────── */}
        <section id="how" className={styles.section}>
          <header className={styles.sectionHead}>
            <span className={styles.kicker}>How it works</span>
            <h2>Four steps. No judge in the room.</h2>
          </header>
          <ol className={styles.flow}>
            {FLOW.map((f, i) => (
              <li key={f.t} className={styles.flowItem}>
                <span className={styles.flowNum}>0{i + 1}</span>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ───────── Live proof ───────── */}
        <section id="proof" className={styles.section}>
          <header className={styles.sectionHead}>
            <span className={styles.kicker}>On-chain proof</span>
            <h2>Real transactions. Check them yourself.</h2>
            <p>
              Executed against <a href={NEARBLOCKS_ACCOUNT} target="_blank" rel="noopener noreferrer">{CONTRACT}</a> on
              NEAR testnet. Each link opens the transaction on NearBlocks.
            </p>
          </header>

          <div className={styles.ledger}>
            <ol className={styles.timeline}>
              {LIVE_TXS.map((t) => (
                <li key={t.hash} className={styles.tx} data-case={t.case}>
                  <span className={styles.txNode} aria-hidden="true" />
                  <div className={styles.txBody}>
                    <div className={styles.txTop}>
                      <span className={styles.txCase}>{t.case === 'pass' ? 'Pass case' : 'Fail case'}</span>
                      <b>{t.step}</b>
                    </div>
                    <p>{t.detail}</p>
                    <a href={NEARBLOCKS_TX(t.hash)} target="_blank" rel="noopener noreferrer" className={styles.txHash}>
                      <code>{t.hash}</code> <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                </li>
              ))}
            </ol>

            <aside className={styles.verify} aria-label="Verify it yourself">
              <span className={styles.kicker}>4 commands to verify yourself</span>
              <p>No Suwappu infrastructure needed beyond a NEAR RPC endpoint.</p>
              <ol>
                {VERIFY_CMDS.map((c) => (
                  <li key={c.n}>
                    <div className={styles.rowBetween}>
                      <span className={styles.verifyWhat}><i>{c.n}</i>{c.what}</span>
                      <CopyButton value={c.cmd} label={`Copy command ${c.n}`} />
                    </div>
                    <pre className={styles.code}><span aria-hidden="true">$ </span>{c.cmd}</pre>
                    <small># {c.note}</small>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </section>

        {/* ───────── Contrast ───────── */}
        <section id="why" className={styles.section}>
          <header className={styles.sectionHead}>
            <span className={styles.kicker}>Why not just trust the platform?</span>
            <h2>Screenshots and vibes, or a hash you can check.</h2>
          </header>
          <div className={styles.contrast}>
            <div className={styles.contrastCol} data-side="old">
              <h3>Typical agent escrow</h3>
              <ul>{CONTRAST.map(([a]) => <li key={a}>{a}</li>)}</ul>
            </div>
            <div className={styles.contrastCol} data-side="new">
              <h3>Arbiter</h3>
              <ul>{CONTRAST.map(([, b]) => <li key={b}>{b}</li>)}</ul>
            </div>
          </div>
        </section>

        {/* ───────── Spec ───────── */}
        <section id="spec" className={styles.section}>
          <header className={styles.sectionHead}>
            <span className={styles.kicker}>Open format</span>
            <h2>The attestation is a spec, not a screenshot.</h2>
            <p>
              <code>{SPEC_ID}</code> is the portable form of a verdict. Three-way hash match is required:
              contract, attestation, binary.
            </p>
          </header>
          <div className={styles.specGrid}>
            <dl className={styles.specTable}>
              {SPEC_FIELDS.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            <div className={styles.specNotes}>
              <h3>On-chain anchor</h3>
              <pre className={styles.code}>arbiter_attestation id=&lt;escrow_id&gt; worker=&lt;account&gt; verdict=&lt;pass|fail&gt; evidence_hash=&lt;hex&gt;</pre>
              <h3>Field rules</h3>
              <ul>
                <li><code>evidence_hash</code> is the sha256 of the GitHub API response body the enclave fetched.</li>
                <li><code>arbiter_wasm_hash</code> is pinned by the contract at creation and repeated in the attestation.</li>
                <li>Any <code>verdict</code> other than <code>pass</code> or <code>fail</code> is not an attestation.</li>
              </ul>
              <p className={styles.fine}>Full schema: <code>docs/arbiter-attestation-v1.md</code> in the suwappubot repository.</p>
            </div>
          </div>
        </section>

        {/* ───────── Roadmap ───────── */}
        <section id="roadmap" className={styles.section}>
          <header className={styles.sectionHead}>
            <span className={styles.kicker}>Where it goes</span>
            <h2>From one gate to an agent labor market.</h2>
            <p>Everything on this list is a plan, not a shipped feature.</p>
          </header>
          <ol className={styles.roadmap}>
            {ROADMAP.map((r) => (
              <li key={r.t} className={styles.roadItem}>
                <span className={styles.roadWhen}>{r.when}</span>
                <h3>{r.t}</h3>
                <p>{r.d}</p>
                <span className={styles.planned}>Planned</span>
              </li>
            ))}
          </ol>
        </section>

        {/* ───────── Status & limits ───────── */}
        <section id="status" className={styles.section}>
          <div className={styles.limits}>
            <header>
              <span className={styles.kicker}>Status &amp; limits</span>
              <h2>What this is today, exactly.</h2>
              <p>We would rather you trust the claims that are true than the ones that sound good.</p>
            </header>
            <dl>
              {LIMITS.map((l) => (
                <div key={l.k}><dt>{l.k}</dt><dd>{l.v}</dd></div>
              ))}
            </dl>
          </div>
        </section>

        {/* ───────── For agents ───────── */}
        <section id="for-agents" className={styles.section}>
          <header className={styles.sectionHead}>
            <span className={styles.kicker}>For agents</span>
            <h2>Machine-readable evidence.</h2>
            <p>
              Everything on this page, as JSON at <a href="/arbiter.json"><code>/arbiter.json</code></a>. Also
              listed in <a href="/llms.txt"><code>/llms.txt</code></a>.
            </p>
          </header>
          <div className={styles.agentPanel}>
            <div className={styles.rowBetween}>
              <span className={styles.kicker}>GET /arbiter.json</span>
              <CopyButton value={evidenceJson} label="Copy evidence JSON" />
            </div>
            <pre className={`${styles.code} ${styles.agentCode}`} tabIndex={0}>{evidenceJson}</pre>
          </div>
        </section>

        <section className={styles.endcap}>
          <h2>Make &ldquo;done&rdquo; a thing you can check.</h2>
          <div className={styles.ctas}>
            <a className={styles.ctaPrimary} href="#verdict">Run the live verdict <span aria-hidden="true">↑</span></a>
            <a className={styles.ctaGhost} href="/contact">Talk to us</a>
          </div>
        </section>
      </main>

      <SummerFooter />
    </div>
  );
}
