import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';

const SITE = 'https://suwappu.bot';
const BASE = '/research/replication';
const AUTHOR_NAME = 'Tsolmondorj Natsagdorj';

export const metadata: Metadata = {
  title: 'Data & code availability — Suwappu Research',
  description:
    'Full working papers, collection harness, analysis code and datasets behind the Suwappu Research papers on USDT0 collateralization and points-program equilibria. Public RPC only, no credentials required.',
  alternates: { canonical: BASE },
  openGraph: {
    title: 'Data & code availability — Suwappu Research',
    description:
      'Papers, code and data behind the USDT0 collateral reconciliation and the Tullock-contest analysis of points programs.',
    type: 'article',
    url: BASE,
  },
};

type Row = { file: string; size: string; desc: string };

const PAPERS: Row[] = [
  {
    file: 'papers/usdt0-collateral-reconciliation.md',
    size: '33 KB',
    desc: 'Measuring Collateral Backing of an Omnichain Dollar: A Point-in-Time Reconciliation of USDT0, Twice Corrected (v3, 31 Jul 2026).',
  },
  {
    file: 'papers/points-tullock-contests.md',
    size: '30 KB',
    desc: 'Points Programs as Tullock Contests: Equilibrium Concentration, Denomination, and Sybil Neutrality — with the 31 Jul postscript reporting the empirical test.',
  },
  {
    file: 'papers/airdrop-concentration.md',
    size: '22 KB',
    desc: 'Who Actually Collected the Airdrops: Testing the Tullock Active-Set Prediction Against Completed Allocations.',
  },
];

const CODE_USDT0: Row[] = [
  {
    file: 'code/collect_usdt0.py',
    size: '14 KB',
    desc: 'Collection harness. Interpolation-accelerated point-in-time block resolution per chain, then direct eth_call reads of totalSupply() and balanceOf(). Public RPC endpoints only. Needs DAYS=365 STEP_HOURS=48 to reproduce the 183-observation panel.',
  },
  { file: 'code/analyze_usdt0.py', size: '6.8 KB', desc: 'Ratio series, summary statistics, exhibits.' },
  { file: 'code/break_scan2.py', size: '2.4 KB', desc: 'Six-hourly rescan bracketing the August 2025 event.' },
  {
    file: 'code/robustness.py',
    size: '9.1 KB',
    desc: 'Serial correlation, changepoint search, stationary block bootstrap, Newey–West HAC inference, ADF, coverage thresholds.',
  },
  {
    file: 'code/predicate_backfill.py',
    size: '2.7 KB',
    desc: 'Correction 2: archive reads of the canonical Polygon PoS predicate at the panel’s 16 pre-break aligned blocks.',
  },
  {
    file: 'code/buffer_dynamics.py',
    size: '5.3 KB',
    desc: 'Flow-coupling regressions (Δcollateral on Δliabilities, both regimes), level tests, and the discrete-operation table.',
  },
  {
    file: 'code/head_snapshot.py',
    size: '4.3 KB',
    desc: 'The complete-universe head reading: every documented leg in one session.',
  },
];

const CODE_POINTS: Row[] = [
  {
    file: 'code/tullock_sim.py',
    size: '11 KB',
    desc: 'Exact active-set equilibrium solver, cost-invariance and revenue-capture scenarios, sybil tests.',
  },
  { file: 'code/tullock_mc.py', size: '4.4 KB', desc: '500-draw Monte Carlo per σ at n = 5,000, plus the sybil-gain sensitivity sweep.' },
  {
    file: 'code/verify_equilibrium.py',
    size: '3.6 KB',
    desc: 'Four-check verification suite: FOC residuals, entry conditions, grid search over unilateral deviations, independent damped best-response.',
  },
  { file: 'code/exhibits.py', size: '14 KB', desc: 'Print exhibits.' },
  { file: 'code/exhibits_web.py', size: '12 KB', desc: 'Web exhibits in the site palette (SVG).' },
];

const DATA_USDT0: Row[] = [
  { file: 'data/usdt0_panel.csv', size: '268 KB', desc: '3,843 raw entity-date observations across 21 measured entities, with per-cell status.' },
  { file: 'data/usdt0_timeseries.csv', size: '68 KB', desc: '183 aligned rows: per-chain supply, collateral, ratio, legacy-escrow controls.' },
  { file: 'data/usdt0_break.csv', size: '2.0 KB', desc: 'Six-hourly bracketing panel, 2025-08-25 to 2025-09-01.' },
  { file: 'data/usdt0_summary.json', size: '2.4 KB', desc: 'Computed summary statistics reproduced in Tables 1, 3 and 5.' },
  { file: 'data/robustness.json', size: '2.5 KB', desc: 'Every statistic in Section 4, including the coverage-sensitivity thresholds.' },
  {
    file: 'data/usdt0_panel_v1_12chain.csv',
    size: '208 KB',
    desc: 'The superseded 12-chain panel, retained so the correction can be checked directly rather than taken on trust.',
  },
  { file: 'data/universe_table.md', size: '1.4 KB', desc: 'Documented deployment set versus measured set.' },
  {
    file: 'data/polygon_predicate_prebreak.json',
    size: '1 KB',
    desc: 'Correction 2’s evidence: canonical-predicate balances at the 16 pre-break aligned blocks ($1.22–1.39bn throughout).',
  },
  { file: 'data/buffer_dynamics.json', size: '3 KB', desc: 'Per-leg and aggregate flow betas, the full census of eleven >$100m discretionary operations, and the terminal drawdown.' },
  { file: 'data/head_snapshot_20260801.json', size: '2 KB', desc: 'The complete-universe head reading: 20 legs, ratio 1.0003, buffer $1.03m, HyperCore containment check.' },
];

const CODE_AIRDROP: Row[] = [
  {
    file: 'code/collect_airdrops.py',
    size: '11 KB',
    desc: 'Recipient-vector collectors: HYPE genesis state via hypurrscan; EIGEN and ENA via checkpointed, range-splitting eth_getLogs scans on free RPCs.',
  },
  {
    file: 'code/analyze_airdrops.py',
    size: '9 KB',
    desc: 'Concentration statistics, Lorenz curves, the σ back-out, matched-n model bands, and the sup-over-σ joint rejection test. Seed 20260731.',
  },
];

const DATA_AIRDROP: Row[] = [
  { file: 'data/airdrops/hype_genesis_raw.json', size: '4.9 MB', desc: 'The complete raw HYPE genesis holder state, 90,918 addresses — before any exclusion, so the system-account step is auditable.' },
  { file: 'data/airdrops/hype_recipients.json', size: '4.9 MB', desc: '90,912 recipient wallets after the six documented system-account exclusions, with fetched address tags.' },
  { file: 'data/airdrops/eigen_recipients.json', size: '14 MB', desc: '239,035 EIGEN S1 claim recipients, both phases merged per wallet, summed from the two real distributor transfer logs.' },
  { file: 'data/airdrops/ena_recipients.json', size: '~8 MB', desc: 'All four Ethena-seeded ENA claim channels merged, seeds verified on-chain to exactly 750M, with residual balances quantified.' },
  { file: 'data/airdrops/ena_v1_partial_superseded.json', size: '1.9 MB', desc: 'The superseded single-channel ENA collection, retained so the correction is auditable.' },
  { file: 'data/airdrops/concentration.json', size: '25 KB', desc: 'Every statistic in the paper: top-k shares, Ginis, Lorenz points, model bands at matched n, and the joint rejection test.' },
];

const DATA_POINTS: Row[] = [
  { file: 'data/tullock_results.json', size: '4.8 KB', desc: 'Propositions 1–4: symmetric equilibrium, cost invariance, heterogeneous active sets, sybil neutrality, revenue capture.' },
  { file: 'data/tullock_mc.json', size: '3.1 KB', desc: 'Monte Carlo sampling distributions per σ, and the sybil sensitivity sweep.' },
  { file: 'data/verify_output.txt', size: '3.8 KB', desc: 'Raw output of the verification suite.' },
  { file: 'data/sim_output.txt', size: '596 B', desc: 'Raw output of the simulation.' },
];

function FileTable({ rows }: { rows: Row[] }) {
  return (
    <div className="repl-tablewrap">
      <table className="repl-table">
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col">Size</th>
            <th scope="col">Contents</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.file}>
              <td>
                <a className="repl-file" href={`${BASE}/${r.file}`}>
                  {r.file}
                </a>
              </td>
              <td className="repl-size">{r.size}</td>
              <td>{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReplicationPage() {
  // Dataset markup: this page is the landing page for two released datasets, and
  // that is what makes them discoverable in dataset search rather than only as
  // prose on an article page.
  const datasetLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Suwappu Research replication bundle — USDT0 collateralization and points-program equilibria',
    description:
      'Twelve months of block-height-aligned USDT0 collateral and cross-chain supply read directly from public EVM state across 17 chains, plus the exact-equilibrium solver and Monte Carlo behind the Tullock-contest analysis of points programs.',
    url: `${SITE}${BASE}`,
    datePublished: '2026-07-26',
    isAccessibleForFree: true,
    license: `${SITE}${BASE}/README.md`,
    creator: { '@type': 'Person', name: AUTHOR_NAME },
    publisher: { '@type': 'Organization', name: 'Suwappu', url: SITE },
    keywords: [
      'omnichain stablecoin',
      'USDT0',
      'stablecoin collateralization',
      'proof of reserves',
      'Tullock contest',
      'points program design',
      'airdrop concentration',
    ],
    measurementTechnique: 'Direct eth_call reads of totalSupply() and balanceOf() at point-in-time-aligned block heights',
    temporalCoverage: '2025-07-26/2026-07-25',
    distribution: [
      {
        '@type': 'DataDownload',
        name: 'usdt0_timeseries.csv',
        encodingFormat: 'text/csv',
        contentUrl: `${SITE}${BASE}/data/usdt0_timeseries.csv`,
      },
      {
        '@type': 'DataDownload',
        name: 'usdt0_panel.csv',
        encodingFormat: 'text/csv',
        contentUrl: `${SITE}${BASE}/data/usdt0_panel.csv`,
      },
      {
        '@type': 'DataDownload',
        name: 'tullock_mc.json',
        encodingFormat: 'application/json',
        contentUrl: `${SITE}${BASE}/data/tullock_mc.json`,
      },
    ],
  };

  return (
    <main id="main-content" className="summer-page docs-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetLd) }} />
      <Navigation />
      <div className="summer-shell mkt-page repl-page">
        <nav className="doc-breadcrumb">
          <a href="/">Home</a>
          <span className="doc-breadcrumb__sep">/</span>
          <a href="/research">Research</a>
          <span className="doc-breadcrumb__sep">/</span>
          <span>Replication</span>
        </nav>

        <header className="mkt-hero">
          <p className="summer-kicker">Data &amp; code availability</p>
          <h1>Everything behind the papers.</h1>
          <p className="mkt-hero__lead">
            Full working papers, the collection harness, the analysis, the statistical tests and
            every dataset they cite. No credentials are required: the chain reads use public RPC
            endpoints and the simulation runs offline.
          </p>
        </header>

        <p className="repl-note">
          The posts on this site are abridgements. <strong>Where an abridgement and a paper
          disagree, the paper governs.</strong> Start with{' '}
          <a href={`${BASE}/README.md`}>README.md</a>, which carries the run instructions and each
          paper&rsquo;s stated limits.
        </p>

        <section className="repl-section">
          <h2>Working papers</h2>
          <FileTable rows={PAPERS} />
        </section>

        <section className="repl-section">
          <h2>Paper 1 — USDT0 collateral reconciliation</h2>
          <p>
            A 12-month, block-height-aligned reconciliation of USDT0&rsquo;s lockbox collateral
            against circulating liabilities on 17 EVM chains, read directly from chain state. No
            block explorer API, subgraph or third-party indexer is used anywhere in the panel.
          </p>
          <h3>Code</h3>
          <FileTable rows={CODE_USDT0} />
          <h3>Data</h3>
          <FileTable rows={DATA_USDT0} />
          <p className="repl-caveat">
            <strong>Stated limits.</strong> Tron, TON and MegaETH are unmeasured, so measured
            liabilities are a lower bound and every ratio is an <em>upper</em> bound. The panel is
            unbalanced — chains returning live supply rise from 8 to 17 across the sample — so the
            level of the ratio is not comparable across time. The not-deployed label is not verified
            by an <code>eth_getCode</code> check, so archive-depth failure and genuine non-deployment
            are not distinguished; both are zero-filled and both bias the ratio up.
          </p>
        </section>

        <section className="repl-section">
          <h2>Paper 2 — Points programs as Tullock contests</h2>
          <p>
            The exact active-set equilibrium of a pro-rata points pool, its Monte Carlo sampling
            distribution, and the verification suite. Seeded with{' '}
            <code>np.random.default_rng(20260726)</code>; the numbers are reproducible bit-for-bit
            with no network access.
          </p>
          <h3>Code</h3>
          <FileTable rows={CODE_POINTS} />
          <h3>Data</h3>
          <FileTable rows={DATA_POINTS} />
          <p className="repl-caveat">
            <strong>Stated limits.</strong> No number in this paper is calibrated against an observed
            points program: it is the equilibrium of a stated game with sampling bands, not a
            measurement. Three of the four verification checks evaluate or solve the model&rsquo;s own
            first-order condition, so the suite establishes that the solver solves the stated game —
            not that the game describes reality. The model assumes complete information, simultaneous
            moves, risk neutrality, linear costs and no capital constraint.
          </p>
        </section>

        <section className="repl-section">
          <h2>Paper 3 — Airdrop concentration: testing the model</h2>
          <p>
            Complete recipient-level allocation vectors for Hyperliquid&rsquo;s HYPE genesis and
            EigenLayer&rsquo;s EIGEN Season 1 — 309,000 rows — plus the formal sup-over-σ rejection
            of the theory paper&rsquo;s active-set prediction. The raw pre-exclusion HYPE state is
            included so the paper&rsquo;s single most judgment-laden step is inspectable.
          </p>
          <h3>Code</h3>
          <FileTable rows={CODE_AIRDROP} />
          <h3>Data</h3>
          <FileTable rows={DATA_AIRDROP} />
          <p className="repl-caveat">
            <strong>Stated limits.</strong> All concentration figures are wallet-level and are
            therefore lower bounds on person-level concentration. EIGEN is claims data (unclaimed
            allocations invisible, biasing concentration up); HYPE is true allocation. The ENA
            vector is deliberately partial — its distribution ran through custodial channels that
            chain state cannot attribute to persons.
          </p>
        </section>

        <section className="repl-section">
          <h2>Environment</h2>
          <p>
            Python 3.12+ with <code>numpy</code>, <code>pandas</code>, <code>scipy</code>,{' '}
            <code>statsmodels</code> and <code>matplotlib</code>. The chain reads use the standard
            library only.
          </p>
        </section>

        <a className="research-post__back" href="/research">
          ← All research
        </a>
      </div>
      <SummerFooter />
    </main>
  );
}
