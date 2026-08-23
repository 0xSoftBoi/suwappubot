import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { API_BASE_URL } from '@/lib/links';
import AutopilotFeed from './AutopilotFeed';
import EquitySparkline from './EquitySparkline';
import PositionsTable from './PositionsTable';
import type {
  AutopilotAgentSummary,
  AutopilotCycle,
  AutopilotDecision,
  AutopilotPosition,
} from './types';
import styles from './autopilot.module.css';

export const metadata: Metadata = {
  title: 'Autopilot | Suwappu autonomous trading agent',
  description:
    'A trading agent that commits to its thesis before it trades, publishes every refusal alongside every fill, and lets anyone recompute the hash it published in advance.',
};

// The page is a live instrument; cache briefly so a burst of readers does not
// hammer the API, but never long enough to show a stale book.
export const revalidate = 30;

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function AutopilotPage() {
  const list = await getJson<{ agents?: AutopilotAgentSummary[] }>('/v1/autopilot');
  const agents = list?.agents ?? [];
  const agent = agents[0];

  const [decisionsPayload, detail] = agent
    ? await Promise.all([
        getJson<{ decisions?: AutopilotDecision[] }>(
          `/v1/autopilot/${agent.slug}/decisions?limit=40`,
        ),
        getJson<{
          portfolio?: { open_positions?: AutopilotPosition[] };
          recent_cycles?: AutopilotCycle[];
        }>(`/v1/autopilot/${agent.slug}`),
      ])
    : [null, null];
  const decisions = decisionsPayload?.decisions ?? [];
  const positions = detail?.portfolio?.open_positions ?? [];
  const cycles = detail?.recent_cycles ?? [];

  const refusals = decisions.filter((d) => !d.gate_passed).length;
  const pnlClass = agent && agent.pnl_usd >= 0 ? styles.up : styles.down;

  return (
    <>
      <Navigation />
      <main className={styles.shell}>
        <div className={styles.wrap}>
          <header className={styles.header}>
            <div>
              <h1 className={styles.title}>Autopilot</h1>
              <p className={styles.subtitle}>
                An autonomous agent that hashes its thesis and publishes the hash <em>before</em> it
                trades, then reveals the thesis after. Every refusal is published with the same
                weight as every fill.
              </p>
            </div>
            <span className={styles.live}>
              <span
                className={`${styles.dot} ${agent?.status === 'active' ? '' : styles.dotIdle}`}
                aria-hidden="true"
              />
              {agent ? `${agent.status} · ${agent.mode}` : 'no agent running'}
            </span>
          </header>

          {!agent ? (
            <p className={styles.empty}>
              No agent is running right now.
              <br />
              When one is, its equity, positions, decisions and refusals appear here live — and the
              feed is served from <code>{API_BASE_URL}/v1/autopilot</code>, which anyone can read
              without an API key.
            </p>
          ) : (
            <>
              <section className={styles.stats} aria-label="Agent status">
                <div className={styles.stat}>
                  <p className={styles.statLabel}>Equity</p>
                  <p className={styles.statValue}>{money(agent.equity_usd)}</p>
                </div>
                <div className={styles.stat}>
                  <p className={styles.statLabel}>P&amp;L</p>
                  <p className={`${styles.statValue} ${pnlClass}`}>
                    {agent.pnl_usd >= 0 ? '+' : ''}
                    {money(agent.pnl_usd)}
                  </p>
                </div>
                <div className={styles.stat}>
                  <p className={styles.statLabel}>Deployed</p>
                  <p className={styles.statValue}>{money(agent.deployed_usd)}</p>
                </div>
                <div className={styles.stat}>
                  <p className={styles.statLabel}>Open positions</p>
                  <p className={styles.statValue}>{agent.open_positions}</p>
                </div>
                <div className={styles.stat}>
                  <p className={styles.statLabel}>Refused (last {decisions.length})</p>
                  <p className={styles.statValue}>{refusals}</p>
                </div>
              </section>

              <EquitySparkline
                cycles={cycles}
                startingEquityUsd={agent.starting_equity_usd}
              />

              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Positions</h2>
                <p className={styles.sectionNote}>
                  exit plans were committed at entry, not chosen now
                </p>
              </div>
              <PositionsTable positions={positions} />

              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Decisions</h2>
                <p className={styles.sectionNote}>
                  {agent.thesis_engine === 'llm' ? 'LLM thesis engine' : 'deterministic engine'} ·{' '}
                  {agent.chain} · updates every 20s
                </p>
              </div>

              <AutopilotFeed slug={agent.slug} initial={decisions} />
            </>
          )}

          <section className={styles.explain}>
            <div className={styles.explainItem}>
              <h3>Why the order matters</h3>
              <p>
                The thesis is hashed and stored before any execution attempt, and revealed
                afterwards. A matching hash proves the argument predates the trade — nobody has to
                take our word for the timing.
              </p>
            </div>
            <div className={styles.explainItem}>
              <h3>Check it yourself</h3>
              <p>
                Every revealed decision above carries a badge your browser produced: it recomputed{' '}
                <code>sha256(&quot;sha256-canonical-v1|&quot; + nonce + &quot;|&quot; + canonical_thesis)</code>{' '}
                with WebCrypto and compared it to the published commitment. No API was asked
                whether the hash was valid.
              </p>
            </div>
            <div className={styles.explainItem}>
              <h3>Refusals are the data</h3>
              <p>
                Every thesis that fails a risk gate is sealed, revealed and published with the full
                rule-by-rule verdict. What an agent declines to buy says more than what it buys.
              </p>
            </div>
          </section>
        </div>
      </main>
      <SummerFooter />
    </>
  );
}
