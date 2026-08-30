'use client';

import { useMemo, useState } from 'react';
import styles from './desk-flow.module.css';

/**
 * The desk's governance topology as a live flow instrument.
 *
 * Columns read the way authority moves: the agent may ask freely, may only
 * propose, everything that costs money passes the mandate and the human, and
 * what comes out the far side is a signature surface, a rewritten envelope,
 * or a server-side policy. Edges animate in that direction; when the page's
 * WebMCP tools are actually called, the matching node pulses, so a judge
 * watching an agent drive the desk sees the diagram light up for real.
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

const CARD_W = 178;
const CARD_H = 38;
const GAP = 9;
const COL_X = [6, 236, 470, 704, 938];
const TOP = 46;
const COL_TITLES = ['YOUR AGENT', 'IT MAY ASK, FREELY', 'IT MAY ONLY PROPOSE', 'THE GATE', 'WHAT COMES OUT'];

export default function DeskFlow({ lastTool }: { lastTool: string | null }) {
  const [focus, setFocus] = useState<string | null>(null);

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

  const dimmed = (a: string, b?: string) => {
    if (!focus) return false;
    if (b === undefined) return a !== focus && !neighbours.get(focus)?.has(a);
    return a !== focus && b !== focus;
  };

  return (
    <section className={styles.panel} aria-label="How authority flows through the desk">
      <p className={styles.head}>
        DESK FLOW · 19 TOOLS, ONE MANDATE, AND EVERY WRITE STOPS AT A HUMAN
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
              data-dim={dimmed(a, b) || undefined}
            />
          ))}

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
