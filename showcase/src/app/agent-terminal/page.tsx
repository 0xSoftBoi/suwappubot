import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import AgentDesk from './AgentDesk';
import stats from '@/data/stats.generated.json';
import styles from './agent-desk.module.css';

export const metadata: Metadata = {
  title: 'Agent Desk | Give your agent a mandate, not your keys',
  description:
    'A cross-chain trading desk that exposes itself to browser agents as WebMCP site tools, bounded by a mandate the human writes and the agent can read. It proposes trades and plans against your rules; you approve, and signing stays in a wallet surface you control.',
  alternates: { canonical: '/agent-terminal' },
};

const TOOLS = [
  {
    name: 'read_mandate',
    kind: 'read',
    body: 'The envelope the human wrote: per-trade and daily caps, allowed chains and tokens, ceilings on impact and slippage, and how much of today is already spent. The agent reads this first.',
  },
  {
    name: 'check_mandate',
    kind: 'read',
    body: 'Dry-run a trade against the mandate silently. Returns the exact rules it breaks, with limit and actual — so the agent iterates on size or chain instead of burning the human\u2019s attention.',
  },
  {
    name: 'amend_mandate',
    kind: 'completes',
    body: 'The agent proposes a change to the envelope itself, citing what happened. You see a before/after diff with every loosened rule flagged in red. Approve and the mandate really changes, here, and persists — the one thing on this desk that finishes in place.',
  },
  {
    name: 'compile_mandate_to_policy',
    kind: 'completes',
    body: 'Compiles the negotiated envelope into Suwappu wallet spending-policy payloads — the request bodies that create real Turnkey policies gating managed execution. Honest notes say what did not survive the compile.',
  },
  {
    name: 'navigate_desk',
    kind: 'read',
    body: 'Moves the human\u2019s view to a section and reports what lives there and which tools act on it. Pointing at the approvals queue beats describing it blind.',
  },
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
    body: 'Price a same-chain or cross-chain swap and render it on the desk: amount out, minimum received, price impact, bridge fee, gas, settlement time, route — plus the mandate verdict.',
  },
  {
    name: 'compare_routes',
    kind: 'read',
    body: 'The same swap priced four ways — recommended, fastest, cheapest, safest — as a table the human can read at a glance.',
  },
  {
    name: 'read_desk',
    kind: 'read',
    body: 'Re-orient after the human clicks something: the ticket, the live quote, the mandate and its headroom, every proposal and its state.',
  },
  {
    name: 'propose_swap',
    kind: 'propose',
    body: 'Put one trade in front of the human with a written rationale and its mandate verdict. Creates a pending card. Signs nothing.',
  },
  {
    name: 'propose_plan',
    kind: 'propose',
    body: 'Propose a sequence — bridge, then buy, then set an alert — as one card with a combined notional and one Approve. Agents think in plans; approving them a click at a time is what makes agentic UX exhausting.',
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
    name: 'request_override',
    kind: 'unlocked',
    body: 'Only exists while a proposal is blocked by the mandate. The agent cannot route around your rules, but it can argue with them — once, in the open, as its own card.',
  },
  {
    name: 'open_signing_handoff',
    kind: 'unlocked',
    body: 'Only registered while an approved, unspent proposal exists. Hands the trade to Terminal or the Telegram bot, pre-filled, where the human signs.',
  },
  {
    name: 'export_receipt',
    kind: 'read',
    body: 'The audit trail: every tool call, every rationale, every mandate verdict, every human decision and note. Downloadable, so "what did my agent do and why" has an answer.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'You write the mandate',
    body: 'Caps per trade and per day, which chains it may touch, which tokens it may buy, how much price impact and slippage you will wear. It lives in your browser, not on our servers.',
  },
  {
    n: '02',
    title: 'The agent reads it before it spends your attention',
    body: 'check_mandate is silent and free. The agent sizes the trade to fit your envelope instead of showing you things you were always going to refuse.',
  },
  {
    n: '03',
    title: 'It proposes, in writing',
    body: 'One trade or a whole plan, priced, with the reason and the mandate verdict attached. A proposal outside the envelope lands in red with Approve locked.',
  },
  {
    n: '04',
    title: 'It can argue, but it cannot route around you',
    body: 'A blocked proposal unlocks request_override — the agent states its case for bending one named rule, and you allow it once or keep the rule.',
  },
  {
    n: '05',
    title: 'You approve, then you sign',
    body: 'Approval unlocks the handoff tool, which opens Terminal or the bot with the trade pre-filled. This page never holds a key or signs a transaction.',
  },
  {
    n: '06',
    title: 'The envelope itself evolves',
    body: 'When a rule keeps blocking things you clearly want, the agent proposes amending it and cites the evidence. You see a diff with loosened rules flagged in red. Approve, and the mandate changes here — the one thing on this desk that finishes in place.',
  },
  {
    n: '07',
    title: 'It compiles into something that binds',
    body: 'The negotiated envelope compiles to Suwappu wallet spending-policy payloads — real Turnkey policies that gate managed execution server-side, where a browser page cannot reach. You leave with a rule set, not a session.',
  },
  {
    n: '08',
    title: 'You keep the receipt',
    body: 'Every call, rationale, verdict, override argument and decision exports as one file. The record of what your agent did and why is yours, not a scrollback you lose.',
  },
];

export default function AgentTerminalPage() {
  return (
    <main id="main-content" className={`summer-page docs-shell institutional-page ${styles.page}`}>
      <SummerNav />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">WebMCP Agent Desk</p>
          <h1>Give your agent a mandate, not your keys.</h1>
          <p className="mkt-hero__lead">
            Suwappu routes swaps across {stats.agentApiChains} chains, and this page hands that
            engine to whatever agent is driving your browser — as WebMCP site tools bounded by
            an envelope you write. Signing never leaves a surface you control.
          </p>
          <div className="summer-actions">
            <a className="summer-button summer-button--primary" href="#desk-mandate">
              The desk ↓
            </a>
            <a className="summer-button summer-button--secondary" href="#how-it-works">
              How it works ↓
            </a>
            <a className="summer-button summer-button--secondary" href="#tools">
              The tools ↓
            </a>
          </div>
        </header>

        <AgentDesk />

        <section className="institutional-section" id="how-it-works">
          <h2>How a mandate becomes a trade</h2>
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
            Registered with <code className="summer-code">document.modelContext.registerTool()</code>,
            each marked with its capability hints. Two do not exist until your state makes them
            meaningful — dynamic registration is how the agent’s options narrow and widen with
            what you have actually allowed. The ticket itself is a nineteenth, <em>declarative</em>{' '}
            tool: a real <code className="summer-code">&lt;form toolname&gt;</code> an engine can
            fill but only an explicit submit can price. No tool on this page can sign, send, or
            spend.
          </p>
          {(
            [
              ['read', 'Read-only', 'Answer instantly, change nothing.'],
              ['propose', 'Needs your approval', 'Place a card in front of you. Nothing moves until you click.'],
              ['completes', 'Completes on this page', 'The mandate itself: amend it, compile it — approval makes it real.'],
              ['unlocked', 'Unlocked by your state', 'Do not exist until something is blocked or approved.'],
            ] as const
          ).map(([kind, label, note]) => {
            const group = TOOLS.filter((t) => t.kind === kind);
            return (
              <div key={kind} className={styles.toolGroup}>
                <h3 className={styles.toolGroupHead}>
                  {label} <span>{group.length}</span>
                </h3>
                <p className={styles.sectionLead}>{note}</p>
                <div className={styles.cardGrid}>
                  {group.map((t) => (
                    <article key={t.name} className={styles.card}>
                      <h3>
                        <code className="summer-code">{t.name}</code>
                      </h3>
                      <p>{t.body}</p>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <section className="institutional-section" id="try-it">
          <h2>Things to ask your agent here</h2>
          <div className={styles.cardGrid}>
            {[
              'Read my mandate, then find me the biggest ETH→USDC move on Base that still fits inside it.',
              'Compare routes for 0.5 ETH on Base into USDC on Arbitrum, and tell me what the speed costs me.',
              'Build me a plan: bridge some ETH to Arbitrum, buy USDC there, and set an alert if ETH breaks $4,000. Propose it as one thing.',
              'Propose 3 ETH into a token that isn’t on my allow-list, and make the case for why I should let you.',
              'My per-trade cap keeps blocking things I actually want — make the case for raising it.',
              'Turn my rules into something my agent wallet will enforce server-side.',
              'Export the receipt for everything we just did.',
            ].map((prompt) => (
              <article key={prompt} className={`${styles.card} ${styles.promptCard}`}>
                <p>“{prompt}”</p>
              </article>
            ))}
          </div>
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
