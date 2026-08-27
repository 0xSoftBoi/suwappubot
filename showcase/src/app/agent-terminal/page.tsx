import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import AgentDesk from './AgentDesk';
import stats from '@/data/stats.generated.json';
import styles from './agent-desk.module.css';

export const metadata: Metadata = {
  title: 'Agent Desk | A WebMCP trading desk humans and agents share',
  description:
    'A cross-chain trading desk that exposes itself to browser agents as WebMCP site tools. The agent researches routes and proposes trades; the human approves every one, and signing stays in a wallet surface the human controls.',
  alternates: { canonical: '/agent-terminal' },
};

const TOOLS = [
  {
    name: 'list_chains',
    kind: 'read',
    body: 'Every chain Suwappu can route across, with chain keys the other tools accept.',
  },
  {
    name: 'find_token',
    kind: 'read',
    body: 'Resolve a ticker or address on one chain into a canonical address and decimals — the step that stops an agent from quoting the wrong "USDC".',
  },
  {
    name: 'get_prices',
    kind: 'read',
    body: 'USD spot for major symbols, so the agent can reason about size before it quotes.',
  },
  {
    name: 'preview_swap',
    kind: 'read',
    body: 'Price a same-chain or cross-chain swap and render it on the desk: amount out, minimum received, price impact, bridge fee, gas, settlement time, route.',
  },
  {
    name: 'compare_routes',
    kind: 'read',
    body: 'The same swap priced four ways — recommended, fastest, cheapest, safest — as a table the human can read at a glance.',
  },
  {
    name: 'read_desk',
    kind: 'read',
    body: 'Re-orient after the human clicks something: the ticket, the live quote, every proposal and its state, recent activity.',
  },
  {
    name: 'propose_swap',
    kind: 'propose',
    body: 'Put a trade in front of the human with a written rationale. Creates a pending card. Signs nothing.',
  },
  {
    name: 'propose_price_alert',
    kind: 'propose',
    body: 'Propose a price alert to arm in the Suwappu bot. Also pending until approved.',
  },
  {
    name: 'check_approval',
    kind: 'read',
    body: 'Ask what the human decided — or block up to two minutes and resolve the instant they click, along with any note they typed back.',
  },
  {
    name: 'open_signing_handoff',
    kind: 'unlocked',
    body: 'Only registered while an approved, unspent proposal exists. Hands the trade to Terminal or the Telegram bot, pre-filled, where the human signs.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'The agent reads the market',
    body: 'It calls the read tools directly on the page — chains, tokens, prices, live routes — instead of scraping a UI built for eyes.',
  },
  {
    n: '02',
    title: 'It proposes, in writing',
    body: 'A proposal card appears on the desk with the priced trade and the reason for it. The agent cannot skip this step: nothing else moves money.',
  },
  {
    n: '03',
    title: 'You approve or reject',
    body: 'You can type a note back. The agent is waiting on check_approval and hears your answer the moment you click.',
  },
  {
    n: '04',
    title: 'You sign, where you keep your keys',
    body: 'Approval unlocks the handoff tool, which opens Terminal or the bot with the trade pre-filled. This page never holds a key or signs a transaction.',
  },
];

export default function AgentTerminalPage() {
  return (
    <main id="main-content" className="summer-page docs-shell institutional-page">
      <SummerNav />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">WebMCP</p>
          <h1>A trading desk that talks to your agent.</h1>
          <p className="mkt-hero__lead">
            Suwappu routes swaps across {stats.agentApiChains} chains. This page hands that engine to whatever
            agent is driving your browser as WebMCP site tools — and keeps you in the chair:
            the agent researches and proposes, you approve, and signing never leaves a surface
            you control.
          </p>
        </header>

        <AgentDesk />

        <section className="institutional-section" id="how-it-works">
          <h2>How a proposal becomes a trade</h2>
          <div className={styles.cardGrid}>
            {STEPS.map((s) => (
              <article key={s.n} className={styles.card}>
                <p className="summer-kicker">{s.n}</p>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="institutional-section" id="tools">
          <h2>The tools this page registers</h2>
          <p className={styles.sectionLead}>
            Registered with <code className="summer-code">document.modelContext.registerTool()</code>.
            Read tools are marked <code className="summer-code">readOnlyHint</code>. No tool on this
            page can sign, send, or spend.
          </p>
          <div className={styles.cardGrid}>
            {TOOLS.map((t) => (
              <article key={t.name} className={styles.card}>
                <h3>
                  <code className="summer-code">{t.name}</code>
                </h3>
                <p>{t.body}</p>
                <p className="summer-kicker">
                  {t.kind === 'read'
                    ? 'read-only'
                    : t.kind === 'propose'
                      ? 'needs human approval'
                      : 'unlocked by approval'}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="institutional-section" id="try-it">
          <h2>Things to ask your agent here</h2>
          <ul className={styles.promptList}>
            <li>
              “Compare routes for 0.5 ETH on Base into USDC on Arbitrum, and tell me what the
              speed costs me.”
            </li>
            <li>
              “Find the real USDC on Base, then price 1,000 of it into cbBTC and propose it if
              the price impact is under 0.3%.”
            </li>
            <li>“What does ETH cost right now, and propose an alert if it breaks $4,000.”</li>
            <li>“Read the desk and tell me what I have pending.”</li>
          </ul>
          <p className={styles.sectionLead}>
            Without a WebMCP-capable browser the desk still works by hand — the tools are a
            second door onto the same controls, not the only one.
          </p>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
