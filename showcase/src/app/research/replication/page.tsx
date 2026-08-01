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
    desc: 'Measuring Collateral Backing of an Omnichain Dollar: A Point-in-Time Reconciliation of USDT0 Across 17 Chains.',
  },
  {
    file: 'papers/points-tullock-contests.md',
    size: '29 KB',
    desc: 'Points Programs as Tullock Contests: Equilibrium Concentration, Denomination, and Sybil Neutrality.',
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
