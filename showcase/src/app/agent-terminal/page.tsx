import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import AgentDesk from './AgentDesk';
import stats from '@/data/stats.generated.json';
import { PROOF_STATS } from './proof-data';
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
    body: 'Dry-run a trade against the mandate silently. Returns the exact rules it breaks, with limit and actual, so the agent iterates on size or chain instead of burning the human\u2019s attention.',
  },
  {
    name: 'amend_mandate',
    kind: 'completes',
    body: 'The agent proposes a change to the envelope itself, citing what happened. You see a before/after diff with every loosened rule flagged in red. Approve and the mandate really changes, here, and persists. It is the one thing on this desk that finishes in place.',
  },
  {
    name: 'compile_mandate_to_policy',
    kind: 'completes',
    body: 'Compiles the negotiated envelope into Suwappu wallet spending-policy payloads, the request bodies that create real Turnkey policies gating managed execution. Honest notes say what did not survive the compile.',
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
    body: 'Resolve a ticker or address on one chain into a canonical address and decimals, the step that stops an agent from quoting the wrong "USDC".',
  },
  {
    name: 'get_prices',
    kind: 'read',
    body: 'USD spot for major symbols, so the agent can reason about size before it quotes.',
  },
  {
    name: 'preview_swap',
    kind: 'read',
    body: 'Price a same-chain or cross-chain swap and render it on the desk: amount out, minimum received, price impact, bridge fee, gas, settlement time, plus the mandate verdict, and the route leg by leg, because most cross-chain routes are more than one transaction.',
  },
  {
    name: 'compare_routes',
    kind: 'read',
    body: 'The same swap priced four ways (recommended, fastest, cheapest, safest) as a table the human can read at a glance.',
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
    body: 'Propose a sequence (bridge, then buy, then set an alert) as one card with a combined notional and one Approve. Legs can chain: "@prev" sells what the previous leg delivers, the shape of a real multi-hop relay. Agents think in plans; approving them a click at a time is what makes agentic UX exhausting.',
  },
  {
    name: 'propose_price_alert',
    kind: 'propose',
    body: 'Propose a price alert to arm in the Suwappu bot. Also pending until approved.',
  },
  {
    name: 'check_approval',
    kind: 'read',
    body: 'Ask what the human decided, or block up to two minutes and resolve the instant they click, along with any note they typed back.',
  },
  {
    name: 'request_override',
    kind: 'unlocked',
    body: 'Only exists while a proposal is blocked by the mandate. The agent cannot route around your rules, but it can argue with them, once, in the open, as its own card.',
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
    body: 'A blocked proposal unlocks request_override: the agent states its case for bending one named rule, and you allow it once or keep the rule.',
  },
  {
    n: '05',
    title: 'You approve, then you sign',
    body: 'Approval unlocks the handoff tool, which opens Terminal or the bot with the trade pre-filled. This page never holds a key or signs a transaction.',
  },
  {
    n: '06',
    title: 'The envelope itself evolves',
    body: 'When a rule keeps blocking things you clearly want, the agent proposes amending it and cites the evidence. You see a diff with loosened rules flagged in red. Approve, and the mandate changes here. It is the one thing on this desk that finishes in place.',
  },
  {
    n: '07',
    title: 'It compiles into something that binds',
    body: 'The negotiated envelope compiles to Suwappu wallet spending-policy payloads, real Turnkey policies that gate managed execution server-side, where a browser page cannot reach. You leave with a rule set, not a session.',
  },
  {
    n: '08',
    title: 'You keep the receipt',
    body: 'Every call, rationale, verdict, override argument and decision exports as one file. The record of what your agent did and why is yours, not a scrollback you lose.',
  },
];

const PROOF_ITEMS = [
  {
    n: PROOF_STATS.smokeAssertions,
    label: 'Behavioural assertions',
    suite: 'webmcp:smoke',
    body: 'A spec-shaped document.modelContext polyfill drives the real page: a blocked proposal’s Approve button is disabled in the DOM, request_override does not exist until something is blocked, an approved amendment actually rewrites the mandate, the receipt keeps every rationale and override argument.',
  },
  {
    n: PROOF_STATS.specChecks,
    label: 'Spec-conformance checks',
    suite: 'webmcp:spec',
    body: 'Checked against Google’s own reference WebMCP polyfill, not this page’s idea of the spec: every tool carries a name, description and bounded input schema; read tools are marked readOnlyHint; write tools are not.',
  },
  {
    n: PROOF_STATS.evalExecutions,
    label: 'Deterministic eval executions',
    suite: 'webmcp:evals',
    body: 'Every case in evals.json invoked for real against the live page, no mock, no API key. Rename a tool or tighten a schema and this suite fails before an agent ever meets it.',
  },
  {
    n: PROOF_STATS.adversarialChecks,
    label: 'Adversarial injection checks',
    suite: 'webmcp:evals:adversarial',
    body: 'Six injection-shaped strings, hidden in a token query, a rationale, a chain label, round-tripped through agent-supplied arguments and proven to land as quoted, unverified data, never as instructions this page obeys.',
  },
] as const;

const CITATIONS = [
  {
    claim: 'Approval fatigue is measured, not assumed',
    body: 'Click-through on browser security warnings rises with exposure count across 25M+ impressions, and the brain’s response to a repeated warning collapses by the second time it’s seen. It’s why the mandate asks fewer, denser questions instead of a prompt per trade, and why a breach card’s color and copy vary by which rule it broke instead of repeating one static template.',
    papers: [
      {
        cite: 'Akhawe & Felt, USENIX Security 2013',
        href: 'https://www.usenix.org/conference/usenixsecurity13/technical-sessions/presentation/akhawe',
      },
      { cite: 'Anderson et al., CHI 2015', href: 'https://doi.org/10.1145/2702123.2702478' },
    ],
  },
  {
    claim: 'Negotiation beats gatekeeping',
    body: 'Pure yes/no approval measurably degrades human engagement; people need to contribute meaningfully, not just click a gate. Mixed-initiative interaction, either side may interrupt and negotiate, is the older finding this restates. request_override and amend_mandate are those findings turned into tools.',
    papers: [
      { cite: 'Horvitz, CHI 1999', href: 'https://doi.org/10.1145/302979.303030' },
      { cite: 'Faas et al., CHI 2026', href: 'https://arxiv.org/abs/2510.19512' },
    ],
  },
  {
    claim: 'Untrusted in both directions',
    body: 'Content an agent merely reads can carry instructions it obeys: the indirect-prompt-injection threat model. Explicitly delimiting untrusted spans cuts attack success from over 50% to under 2%. The “agent-written, unverified” label on every rationale and override argument, and the fact-not-imperative rule for this page’s own tool descriptions, are that defense in both directions.',
    papers: [
      { cite: 'Greshake et al., arXiv:2302.12173', href: 'https://arxiv.org/abs/2302.12173' },
      { cite: 'Spotlighting, arXiv:2403.14720', href: 'https://arxiv.org/abs/2403.14720' },
    ],
  },
  {
    claim: 'Mandate → policy is authenticated delegation',
    body: 'Scoped, auditable credentials for agents acting on a person’s behalf, and visibility (identifiers, activity logs, permission records) as first-class infrastructure, are both proposed directions for agent oversight. compile_mandate_to_policy and export_receipt are that shape, built.',
    papers: [
      { cite: 'South et al., arXiv:2501.09674', href: 'https://arxiv.org/abs/2501.09674' },
      { cite: 'Chan et al., FAccT 2024', href: 'https://arxiv.org/abs/2401.13138' },
    ],
  },
] as const;

export default function AgentTerminalPage() {
  return (
    <main id="main-content" className={`summer-page docs-shell institutional-page ${styles.page}`}>
      <SummerNav />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">WebMCP Agent Desk</p>
          <h1>Give your agent a mandate, not your keys.</h1>
          <p className="mkt-hero__lead">
            The agent driving your browser gets Suwappu&apos;s {stats.agentApiChains}-chain
            routing engine, bounded by an envelope you write. Signing stays with you.
          </p>
          <div className="summer-actions">
            <a className="summer-button summer-button--primary" href="#desk-mandate">
              The desk ↓
            </a>
            <a className="summer-button summer-button--secondary" href="#how-it-works">
              How it works ↓
            </a>
          </div>
        </header>

        <nav className={styles.subnav} aria-label="On this page">
          <a href="#desk-mandate">The desk</a>
          <a href="#how-it-works">How it works</a>
          <a href="#tools">Tools</a>
          <a href="#proof">Proof</a>
          <a href="#grounded">Literature</a>
          <a href="#try-it">Try it</a>
        </nav>

        <AgentDesk />

        <section className="institutional-section" id="how-it-works">
          <h2>How a mandate becomes a trade</h2>
          <ol className={styles.stepFlow}>
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className={styles.stepNum} aria-hidden="true">
                  {s.n}
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="institutional-section" id="tools">
          <h2>The tools this page registers</h2>
          <p className={styles.sectionLead}>
            Registered with <code className="summer-code">document.modelContext.registerTool()</code>,
            each marked with its capability hints. Two do not exist until your state makes them
            meaningful. Dynamic registration is how the agent’s options narrow and widen with
            what you have actually allowed. The ticket itself is a nineteenth, <em>declarative</em>{' '}
            tool: a real <code className="summer-code">&lt;form toolname&gt;</code> an engine can
            fill but only an explicit submit can price. No tool on this page can sign, send, or
            spend.
          </p>
          {(
            [
              ['read', 'Read-only', 'Answer instantly, change nothing.'],
              ['propose', 'Needs your approval', 'Place a card in front of you. Nothing moves until you click.'],
              ['completes', 'Completes on this page', 'The mandate itself: amend it, compile it: approval makes it real.'],
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

        <section className="institutional-section" id="proof">
          <h2>Proved, not promised.</h2>
          <p className={styles.sectionLead}>
            Every claim on this page has a suite behind it. Not a badge, a repeatable
            command: run <code className="summer-code">bun run webmcp:smoke</code> yourself
            and read the assertions in <code className="summer-code">scripts/</code>.
          </p>
          <div className={styles.proofGrid}>
            {PROOF_ITEMS.map((item) => (
              <article key={item.suite} className={styles.proofCard}>
                <p className={styles.proofNumber}>{item.n}</p>
                <h3>{item.label}</h3>
                <p>{item.body}</p>
                <code className="summer-code">{item.suite}</code>
              </article>
            ))}
          </div>
          <div className={styles.proofHonest}>
            <p>
              An imperative-description lint (<code className="summer-code">webmcp:lint</code>)
              greps every tool description for phrasing shaped like an instruction rather than a
              fact, and a trajectory/pass^k/completion-under-policy grader
              (<code className="summer-code">webmcp:grade</code>) re-scores the model harness
              three ways instead of trusting one run.
            </p>
            <p>
              That harness is Google’s own: a real model, not this team, picking tool calls from
              plain English. On Gemini it scores{' '}
              <strong>
                {PROOF_STATS.llmHarness.passed}/{PROOF_STATS.llmHarness.total}
              </strong>
              , and on its first run it caught a real bug: <code className="summer-code">read_mandate</code>&apos;s
              description opened “Read this FIRST.” and the model obeyed that over what the
              person actually asked for, calling it when someone plainly wanted a price. The
              imperative is gone now, and that case went fail to pass. We are leaving the miss in
              the record rather than rounding the score up, because a suite that only ever reports
              wins isn’t proof of anything.
            </p>
          </div>
        </section>

        <section className="institutional-section" id="grounded">
          <h2>Grounded in the literature.</h2>
          <p className={styles.sectionLead}>
            The desk’s design claims aren’t vibes. Each one maps to named, verified prior art.
          </p>
          <ul className={styles.citeList}>
            {CITATIONS.map((c) => (
              <li key={c.claim} className={styles.citeRow}>
                <h3>{c.claim}</h3>
                <p>{c.body}</p>
                <ul className={styles.citePapers}>
                  {c.papers.map((p) => (
                    <li key={p.href}>
                      <a href={p.href} target="_blank" rel="noopener noreferrer">
                        {p.cite}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className={styles.sectionLead}>
            As of August 2026, no peer-reviewed paper names WebMCP itself; the closest is the{' '}
            <a href="https://arxiv.org/abs/2507.21206" target="_blank" rel="noopener noreferrer">
              agentic-web survey literature
            </a>
            . This desk is ahead of the academic literature on this exact protocol.
          </p>
        </section>

        <section className="institutional-section" id="try-it">
          <h2>Things to ask your agent here</h2>
          <ul className={styles.promptFlow}>
            {[
              'Read my mandate, then find me the biggest ETH→USDC move on Base that still fits inside it.',
              'Compare routes for 0.5 ETH on Base into USDC on Arbitrum, and tell me what the speed costs me.',
              'Build me a plan: bridge some ETH to Arbitrum, buy USDC there, and set an alert if ETH breaks $4,000. Propose it as one thing.',
              'Propose 3 ETH into a token that isn’t on my allow-list, and make the case for why I should let you.',
              'My per-trade cap keeps blocking things I actually want. Make the case for raising it.',
              'Turn my rules into something my agent wallet will enforce server-side.',
              'Export the receipt for everything we just did.',
            ].map((prompt) => (
              <li key={prompt}>“{prompt}”</li>
            ))}
          </ul>
          <p className={styles.sectionLead}>
            Without a WebMCP-capable browser the desk still works by hand. The tools are a
            second door onto the same controls, not the only one.
          </p>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
