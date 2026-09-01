'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './desk-flow.module.css';

/**
 * The desk's governance topology as a live flow instrument.
 *
 * Columns read the way authority moves: the agent may ask freely, may only
 * propose, everything that costs money passes the mandate and the human, and
 * what comes out the far side is a signature surface, a rewritten envelope,
 * or a server-side policy.
 *
 * Until a real agent connects, the instrument plays a scripted session (read,
 * silent check, proposal, block, argument, approval, handoff) so the diagram
 * narrates the product by itself. The first real WebMCP call takes over: from
 * then on the node for whichever tool the agent just called lights up, and
 * the header reads out the call. Everything kinetic sits behind
 * prefers-reduced-motion.
 */

type EdgeKind = 'read' | 'propose' | 'binds' | 'gated';

interface FlowNode {
  id: string;
  col: number;
  label: string;
  sub: string;
  tool?: string;
  gated?: boolean;
}

const NODES: FlowNode[] = [
  { id: 'agent', col: 0, label: 'Your agent', sub: 'in this browser tab' },

  { id: 'read_mandate', col: 1, label: 'read_mandate', sub: 'the envelope, headroom', tool: 'read_mandate' },
  { id: 'check_mandate', col: 1, label: 'check_mandate', sub: 'silent dry-run', tool: 'check_mandate' },
  { id: 'preview_swap', col: 1, label: 'preview_swap', sub: 'price one trade', tool: 'preview_swap' },
  { id: 'compare_routes', col: 1, label: 'compare_routes', sub: 'four routes, one table', tool: 'compare_routes' },
  { id: 'find_token', col: 1, label: 'find_token', sub: 'the right "USDC"', tool: 'find_token' },
  { id: 'get_prices', col: 1, label: 'get_prices', sub: 'USD spot', tool: 'get_prices' },
  { id: 'list_chains', col: 1, label: 'list_chains', sub: 'routable chains', tool: 'list_chains' },
  { id: 'read_desk', col: 1, label: 'read_desk', sub: 're-orient', tool: 'read_desk' },
  { id: 'navigate_desk', col: 1, label: 'navigate_desk', sub: 'move your view', tool: 'navigate_desk' },
  { id: 'check_approval', col: 1, label: 'check_approval', sub: 'wait on your click', tool: 'check_approval' },
  { id: 'fill_ticket', col: 1, label: 'fill_and_price_ticket', sub: 'the form itself, declarative', tool: 'fill_and_price_ticket' },

  { id: 'propose_swap', col: 2, label: 'propose_swap', sub: 'one trade, in writing', tool: 'propose_swap' },
  { id: 'propose_plan', col: 2, label: 'propose_plan', sub: 'a sequence, one Approve', tool: 'propose_plan' },
  { id: 'propose_alert', col: 2, label: 'propose_price_alert', sub: 'watch a price', tool: 'propose_price_alert' },
  { id: 'amend', col: 2, label: 'amend_mandate', sub: 'argue the rules should change', tool: 'amend_mandate' },
  { id: 'compile', col: 2, label: 'compile_mandate_to_policy', sub: 'make the envelope bind', tool: 'compile_mandate_to_policy' },
  { id: 'override', col: 2, label: 'request_override', sub: 'exists only while blocked', tool: 'request_override', gated: true },

  { id: 'mandate', col: 3, label: 'THE MANDATE', sub: 'caps, chains, tokens, ceilings' },
  { id: 'human', col: 3, label: 'YOU', sub: 'Approve is a DOM button' },

  { id: 'handoff', col: 4, label: 'Signing handoff', sub: 'Terminal or bot; no key here', tool: 'open_signing_handoff', gated: true },
  { id: 'amended', col: 4, label: 'Mandate, amended', sub: 'persists, governs the next check' },
  { id: 'policy', col: 4, label: 'Turnkey wallet policy', sub: 'binds server-side' },
  { id: 'receipt', col: 4, label: 'The receipt', sub: 'every argument, on the record', tool: 'export_receipt' },
];

const EDGES: Array<[string, string, EdgeKind]> = [
  ...NODES.filter((n) => n.col === 1).map((n): [string, string, EdgeKind] => ['agent', n.id, 'read']),
  ['agent', 'propose_swap', 'propose'],
  ['agent', 'propose_plan', 'propose'],
  ['agent', 'propose_alert', 'propose'],
  ['agent', 'amend', 'propose'],
  ['agent', 'compile', 'propose'],
  ['agent', 'override', 'gated'],
  ['check_mandate', 'mandate', 'read'],
  ['propose_swap', 'mandate', 'propose'],
  ['propose_plan', 'mandate', 'propose'],
  ['propose_alert', 'human', 'propose'],
  ['amend', 'human', 'propose'],
  ['override', 'human', 'gated'],
  ['mandate', 'human', 'propose'],
  ['human', 'handoff', 'binds'],
  ['human', 'amended', 'binds'],
  ['compile', 'policy', 'binds'],
  ['human', 'receipt', 'read'],
];

/** The attract loop: one honest session, told edge by edge. */
const STORY: Array<{ caption: string; edges: Array<[string, string]> }> = [
  { caption: 'the agent reads your rules first', edges: [['agent', 'read_mandate']] },
  { caption: 'then dry-runs a trade against them, silently', edges: [['agent', 'check_mandate'], ['check_mandate', 'mandate']] },
  { caption: 'prices the route for real', edges: [['agent', 'preview_swap']] },
  { caption: 'and proposes, in writing', edges: [['agent', 'propose_swap'], ['propose_swap', 'mandate']] },
  { caption: 'or a whole plan (bridge, buy, alert) as ONE approval', edges: [['agent', 'propose_plan'], ['propose_plan', 'mandate']] },
  { caption: 'the mandate attaches its verdict for you', edges: [['mandate', 'human']] },
  { caption: 'blocked? it may argue, once, in the open', edges: [['agent', 'override'], ['override', 'human']] },
  { caption: 'your Approve unlocks the signing handoff', edges: [['human', 'handoff']] },
  { caption: 'the envelope can compile into policy that binds', edges: [['agent', 'compile'], ['compile', 'policy']] },
  { caption: 'and every argument ends up on the receipt', edges: [['human', 'receipt']] },
];

const CARD_W = 178;
const CARD_H = 38;
const GAP = 9;
const COL_X = [6, 236, 470, 704, 938];
const TOP = 46;
const COL_TITLES = ['YOUR AGENT', 'IT MAY ASK, FREELY', 'IT MAY ONLY PROPOSE', 'THE GATE', 'WHAT COMES OUT'];

interface DeskStatus {
  state: 'connected' | 'checking' | 'unavailable' | string;
  tools: number;
  pending: number;
  calls: number;
}

export default function DeskFlow({
  lastTool,
  status,
}: {
  lastTool: string | null;
  status: DeskStatus;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [motionOK, setMotionOK] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: no-preference)');
    setMotionOK(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMotionOK(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // The attract loop runs until the first real tool call, and pauses on hover.
  const storyOn = motionOK && lastTool === null && focus === null;
  useEffect(() => {
    if (!storyOn) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STORY.length), 1500);
    return () => clearInterval(t);
  }, [storyOn]);

  const layout = useMemo(() => {
    const byCol: FlowNode[][] = [[], [], [], [], []];
    for (const n of NODES) byCol[n.col].push(n);
    const tallest = Math.max(...byCol.map((c) => c.length));
    const height = TOP + tallest * (CARD_H + GAP) + 16;
    const pos = new Map<string, { x: number; y: number }>();
    byCol.forEach((col, ci) => {
      const colH = col.length * (CARD_H + GAP) - GAP;
      const start = TOP + (height - TOP - 16 - colH) / 2;
      col.forEach((n, ri) => pos.set(n.id, { x: COL_X[ci], y: start + ri * (CARD_H + GAP) }));
    });
    return { pos, height };
  }, []);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [a, b] of EDGES) {
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    }
    return m;
  }, []);

  const path = (a: string, b: string) => {
    const p1 = layout.pos.get(a)!;
    const p2 = layout.pos.get(b)!;
    const x1 = p1.x + CARD_W;
    const y1 = p1.y + CARD_H / 2;
    const x2 = p2.x;
    const y2 = p2.y + CARD_H / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };

  const scene = STORY[step];
  const hotEdges = useMemo(() => {
    if (!storyOn) return new Set<string>();
    return new Set(scene.edges.map(([a, b]) => `${a}-${b}`));
  }, [storyOn, scene]);
  const hotNodes = useMemo(() => {
    if (!storyOn) return new Set<string>();
    const s = new Set<string>();
    for (const [a, b] of scene.edges) {
      s.add(a);
      s.add(b);
    }
    return s;
  }, [storyOn, scene]);

  const dimmed = (a: string, b?: string) => {
    if (focus) {
      if (b === undefined) return a !== focus && !neighbours.get(focus)?.has(a);
      return a !== focus && b !== focus;
    }
    return false;
  };

  return (
    <section className={styles.panel} aria-label="How authority flows through the desk">
      <p className={styles.head}>
        <span>DESK FLOW · 19 TOOLS, ONE MANDATE, AND EVERY WRITE STOPS AT A HUMAN</span>
        <span className={styles.headLive} data-on={lastTool ? '' : undefined}>
          {lastTool ? (
            <>
              LAST CALL <b>→ {lastTool}</b>
            </>
          ) : storyOn ? (
            scene.caption
          ) : (
            'waiting for an agent'
          )}
        </span>
      </p>
      <div className={styles.scroller}>
        <svg
          viewBox={`0 0 1122 ${layout.height}`}
          className={styles.svg}
          role="img"
          aria-label="Flow diagram: the agent calls read tools freely; anything that spends is a proposal that passes the mandate and a human Approve; approval unlocks a signing handoff, an amended mandate, or a server-side wallet policy."
        >
          {COL_TITLES.map((t, i) => (
            <text key={t} x={COL_X[i]} y={22} className={styles.colTitle}>
              {t}
            </text>
          ))}

          {EDGES.map(([a, b, kind]) => (
            <path
              key={`${a}-${b}`}
              d={path(a, b)}
              className={styles.edge}
              data-kind={kind}
              data-hot={hotEdges.has(`${a}-${b}`) || undefined}
              data-dim={dimmed(a, b) || undefined}
            />
          ))}

          {/* Comets ride the hot edges of the current story beat. */}
          {motionOK &&
            [...hotEdges].map((key) => {
              const [a, b] = key.split('-');
              const kind = EDGES.find(([ea, eb]) => ea === a && eb === b)?.[2] ?? 'read';
              return (
                <circle key={`c-${key}-${step}`} r={3} className={styles.comet} data-kind={kind}>
                  <animateMotion dur="1.4s" repeatCount="indefinite" path={path(a, b)} />
                </circle>
              );
            })}

          {NODES.map((n) => {
            const p = layout.pos.get(n.id)!;
            const gate = n.col === 3;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                className={styles.node}
                data-gate={gate || undefined}
                data-gated={n.gated || undefined}
                data-dim={dimmed(n.id) || undefined}
                data-hot={hotNodes.has(n.id) || undefined}
                data-live={(n.tool && n.tool === lastTool) || undefined}
                onMouseEnter={() => setFocus(n.id)}
                onMouseLeave={() => setFocus(null)}
              >
                <rect width={CARD_W} height={CARD_H} rx={4} />
                <text x={10} y={16} className={styles.label}>
                  {n.label}
                </text>
                <text x={10} y={29} className={styles.sub}>
                  {n.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className={styles.readout}>
        <span
          data-state={
            status.state === 'connected'
              ? 'on'
              : status.state === 'checking'
                ? 'wait'
                : status.state === 'paused'
                  ? 'paused'
                  : 'off'
          }
        >
          AGENT{' '}
          {status.state === 'connected'
            ? 'CONNECTED'
            : status.state === 'checking'
              ? 'LOOKING'
              : status.state === 'paused'
                ? 'PAUSED BY YOU'
                : 'NOT PRESENT'}
        </span>
        <span>TOOLS {status.tools > 0 ? status.tools : '0 (needs a WebMCP browser)'}</span>
        <span>PENDING APPROVALS {status.pending}</span>
        <span>CALLS THIS SESSION {status.calls}</span>
      </p>
      <p className={styles.legend}>
        <span data-kind="read">read, free</span>
        <span data-kind="propose">proposal, needs your Approve</span>
        <span data-kind="binds">binds after approval</span>
        <span data-kind="gated">exists only when your state unlocks it</span>
        <span className={styles.legendNote}>
          hover a node to isolate its flows. the dashes travel the way authority moves.
        </span>
      </p>
    </section>
  );
}
