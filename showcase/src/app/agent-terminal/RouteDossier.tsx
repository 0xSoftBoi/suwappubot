'use client';

import { useMemo, type ReactNode } from 'react';
import type { SwapPreview } from './deskApi';
import { fmtAmount, fmtDuration, fmtUsd, hopChainLabel, num } from './format';
import { RULE_META, type MandateVerdict } from './mandate';
import styles from './route-dossier.module.css';

/**
 * The trade as a forensic dossier: a dense stat band, then the route drawn
 * as a fund-flow graph. Value moves left to right on the main path, and
 * every cost — gas, relay fee — leaves the path as its own node, so what
 * you send, what arrives, and what the route takes are three different
 * things you can point at. Same instrument language as DeskFlow.
 */

interface FlowEndpoint {
  label: string;
  amount: string;
  sub: string;
}

interface FlowHop {
  key: string;
  /** 'swap' | 'cross' | 'protocol' | … — drives the accent colour. */
  type: string;
  tool: string;
  chains: string;
  inAmount: string | null;
  outAmount: string | null;
  feeUsd: number;
  gasUsd: number;
  durationSeconds: number | null;
}

export interface FlowSpec {
  source: FlowEndpoint;
  out: FlowEndpoint;
  hops: FlowHop[];
  /** Labels riding the main-path edges, one per edge (hops.length + 1). */
  edgeLabels: Array<string | null>;
}

const verb = (t: string) => (t === 'cross' ? 'RELAY' : t === 'swap' ? 'SWAP' : t.toUpperCase());

/** Labels riding the main path: what enters, what each later leg sells, what arrives. */
const mainEdgeLabels = (
  hops: FlowHop[],
  first: string | null,
  last: string | null,
): Array<string | null> => [first, ...hops.slice(1).map((h) => h.inAmount), last];

/** A priced single trade → flow spec. Falls back to one honest hop. */
export function specFromPreview(p: SwapPreview): FlowSpec {
  const rawHops =
    Array.isArray(p.hops) && p.hops.length > 0
      ? p.hops
      : [
          {
            index: 0,
            type: p.fromChain === p.toChain ? 'swap' : 'cross',
            tool: p.route,
            toolName: p.route,
            fromChain: p.fromChain,
            toChain: p.toChain,
            fromToken: p.fromToken.symbol,
            toToken: p.toToken.symbol,
            fromAmount: p.fromAmount,
            toAmount: p.toAmount,
            estimatedGasUsd: p.estimatedGasUsd,
            feeUsd: p.bridgeFeeUsd,
            estimatedDurationSeconds: p.estimatedDurationSeconds,
          },
        ];
  const hops: FlowHop[] = rawHops.map((h) => ({
    key: `hop-${h.index}`,
    type: h.type,
    tool: h.toolName || h.tool,
    chains: hopChainLabel(h.fromChain, h.toChain),
    inAmount: h.fromToken ? `${fmtAmount(h.fromAmount)} ${h.fromToken}` : null,
    outAmount: h.toToken ? `${fmtAmount(h.toAmount)} ${h.toToken}` : null,
    feeUsd: num(h.feeUsd) ?? 0,
    gasUsd: num(h.estimatedGasUsd) ?? 0,
    durationSeconds: h.estimatedDurationSeconds,
  }));
  return {
    source: {
      label: 'YOU SEND',
      amount: `${fmtAmount(p.fromAmount)} ${p.fromToken.symbol}`,
      sub: `on ${p.fromChain} · ${fmtUsd(p.fromAmountUsd)}`,
    },
    out: {
      label: 'YOU RECEIVE',
      amount: `${fmtAmount(p.toAmount)} ${p.toToken.symbol}`,
      sub: `on ${p.toChain} · floor ≥ ${fmtAmount(p.toAmountMin)}`,
    },
    hops,
    edgeLabels: mainEdgeLabels(
      hops,
      `${fmtAmount(p.fromAmount)} ${p.fromToken.symbol}`,
      `${fmtAmount(p.toAmount)} ${p.toToken.symbol}`,
    ),
  };
}

/**
 * A chained plan sequence (leg N sells leg N-1's estimated output) → flow
 * spec: each leg is a node, the connecting edges carry what the previous
 * leg delivers.
 */
export function specFromPlanLegs(
  legs: Array<{
    fromChain: string;
    toChain: string;
    fromToken: string;
    toToken: string;
    amount: string;
    preview: SwapPreview | null;
  }>,
): FlowSpec | null {
  if (legs.length === 0) return null;
  const first = legs[0];
  const last = legs[legs.length - 1];
  const hops: FlowHop[] = legs.map((l, i) => ({
    key: `leg-${i}`,
    type: l.fromChain === l.toChain ? 'swap' : 'cross',
    tool: l.preview?.route ?? 'unpriced',
    chains: hopChainLabel(l.fromChain, l.toChain),
    inAmount: `${fmtAmount(l.amount)} ${l.fromToken}`,
    outAmount: l.preview ? `${fmtAmount(l.preview.toAmount)} ${l.toToken}` : null,
    feeUsd: num(l.preview?.bridgeFeeUsd) ?? 0,
    gasUsd: num(l.preview?.estimatedGasUsd) ?? 0,
    durationSeconds: l.preview?.estimatedDurationSeconds ?? null,
  }));
  return {
    source: {
      label: 'NEW MONEY IN',
      amount: `${fmtAmount(first.amount)} ${first.fromToken}`,
      sub: `on ${first.fromChain}${first.preview ? ` · ${fmtUsd(first.preview.fromAmountUsd)}` : ''}`,
    },
    out: {
      label: 'SEQUENCE ENDS',
      amount: last.preview ? `${fmtAmount(last.preview.toAmount)} ${last.toToken}` : last.toToken,
      sub: `on ${last.toChain}${last.preview ? ` · ${fmtUsd(last.preview.toAmountUsd)}` : ''}`,
    },
    hops,
    edgeLabels: mainEdgeLabels(hops, hops[0].inAmount, hops[hops.length - 1].outAmount),
  };
}

/* ── Deterministic SVG layout (DeskFlow-style: no DOM measuring) ── */

const PAD = 8;
const TITLE_Y = 14;
const MAIN_Y = 26;
const END_W = 148;
const END_H = 58;
const HOP_W = 176;
const HOP_H = 58;
const GAP = 82;
const LEAK_GAP = 34;
const LEAK_W = 118;
const LEAK_H = 26;

export function RouteFlowSvg({ spec, ariaLabel }: { spec: FlowSpec; ariaLabel: string }) {
  const k = spec.hops.length;
  const xs = useMemo(() => {
    const sourceX = PAD;
    const hopX = (i: number) => PAD + END_W + GAP + i * (HOP_W + GAP);
    const outX = hopX(k);
    return { sourceX, hopX, outX, width: outX + END_W + PAD };
  }, [k]);

  const leaks = spec.hops
    .map((h, i) => ({ hop: h, i, total: h.feeUsd + h.gasUsd }))
    .filter((l) => l.total > 0);
  const leakY = MAIN_Y + HOP_H + LEAK_GAP;
  const height = leaks.length > 0 ? leakY + LEAK_H + 24 : MAIN_Y + HOP_H + 18;

  const midY = MAIN_Y + HOP_H / 2;
  const mainEdge = (x1: number, x2: number) => {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${midY} C ${mx} ${midY}, ${mx} ${midY}, ${x2} ${midY}`;
  };
  const leakEdge = (i: number) => {
    const hx = xs.hopX(i) + HOP_W / 2;
    const y1 = MAIN_Y + HOP_H;
    const ly = leakY;
    return `M ${hx} ${y1} C ${hx} ${(y1 + ly) / 2}, ${hx} ${(y1 + ly) / 2}, ${hx} ${ly}`;
  };

  return (
    <div className={styles.scroller}>
      <svg
        viewBox={`0 0 ${xs.width} ${height}`}
        className={styles.svg}
        style={{ minWidth: Math.min(xs.width, 900) }}
        role="img"
        aria-label={ariaLabel}
        data-route-flow=""
      >
        <text x={xs.sourceX} y={TITLE_Y} className={styles.colTitle}>
          MONEY IN
        </text>
        {spec.hops.map((h, i) => (
          <text key={`t-${h.key}`} x={xs.hopX(i)} y={TITLE_Y} className={styles.colTitle}>
            LEG {String(i + 1).padStart(2, '0')}
          </text>
        ))}
        <text x={xs.outX} y={TITLE_Y} className={styles.colTitle}>
          WHAT ARRIVES
        </text>

        {/* Main value path, endpoint → each leg → endpoint. */}
        {Array.from({ length: k + 1 }, (_, e) => {
          const x1 = e === 0 ? xs.sourceX + END_W : xs.hopX(e - 1) + HOP_W;
          const x2 = e === k ? xs.outX : xs.hopX(e);
          const label = spec.edgeLabels[e];
          return (
            <g key={`e-${e}`}>
              <path d={mainEdge(x1, x2)} className={styles.mainEdge} />
              {label && (
                <text x={(x1 + x2) / 2} y={midY - 7} className={styles.edgeLabel} textAnchor="middle">
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* Cost leaks: what leaves the path at each leg. */}
        {leaks.map((l) => (
          <g key={`leak-${l.hop.key}`}>
            <path d={leakEdge(l.i)} className={styles.leakEdge} />
            <g transform={`translate(${xs.hopX(l.i) + (HOP_W - LEAK_W) / 2} ${leakY})`} className={styles.leak}>
              <rect width={LEAK_W} height={LEAK_H} rx={3} />
              <text x={8} y={12} className={styles.leakAmount}>
                − {fmtUsd(l.total)}
              </text>
              <text x={8} y={21} className={styles.leakSub}>
                {[l.hop.feeUsd > 0 ? `fee ${fmtUsd(l.hop.feeUsd)}` : null, l.hop.gasUsd > 0 ? `gas ${fmtUsd(l.hop.gasUsd)}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </text>
            </g>
          </g>
        ))}
        {leaks.length > 0 && (
          <text x={xs.sourceX} y={leakY + LEAK_H / 2 + 3} className={styles.leakRowTitle}>
            WHAT THE ROUTE TAKES
          </text>
        )}

        {/* Endpoints. */}
        <g transform={`translate(${xs.sourceX} ${MAIN_Y})`} className={styles.endpoint} data-endpoint="in">
          <rect width={END_W} height={END_H} rx={4} />
          <text x={10} y={15} className={styles.endLabel}>
            {spec.source.label}
          </text>
          <text x={10} y={32} className={styles.endAmount}>
            {spec.source.amount}
          </text>
          <text x={10} y={47} className={styles.endSub}>
            {spec.source.sub}
          </text>
        </g>
        <g transform={`translate(${xs.outX} ${MAIN_Y})`} className={styles.endpoint} data-endpoint="out">
          <rect width={END_W} height={END_H} rx={4} />
          <text x={10} y={15} className={styles.endLabel}>
            {spec.out.label}
          </text>
          <text x={10} y={32} className={styles.endAmount}>
            {spec.out.amount}
          </text>
          <text x={10} y={47} className={styles.endSub}>
            {spec.out.sub}
          </text>
        </g>

        {/* Leg nodes. */}
        {spec.hops.map((h, i) => (
          <g
            key={h.key}
            transform={`translate(${xs.hopX(i)} ${MAIN_Y})`}
            className={styles.hop}
            data-kind={h.type === 'cross' ? 'cross' : h.type === 'swap' ? 'swap' : 'protocol'}
            data-hop=""
            data-hop-type={h.type}
            data-hop-tool={h.tool}
          >
            <rect width={HOP_W} height={HOP_H} rx={4} />
            <rect className={styles.chip} x={HOP_W - 52} y={7} width={44} height={12} rx={2} />
            <text x={HOP_W - 30} y={16} className={styles.chipText} textAnchor="middle">
              {verb(h.type)}
            </text>
            <text x={10} y={17} className={styles.hopTool}>
              {h.tool.length > 16 ? `${h.tool.slice(0, 15)}…` : h.tool}
            </text>
            <text x={10} y={32} className={styles.hopAmounts}>
              {h.inAmount ?? '?'} → {h.outAmount ?? '?'}
            </text>
            <text x={10} y={47} className={styles.hopMeta}>
              {h.chains}
              {h.durationSeconds !== null ? ` · ${fmtDuration(h.durationSeconds)}` : ''}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * A flow embedded in a light proposal card: the dark instrument inset, with
 * an optional lane header (e.g. "RELAY 01") above the graph.
 */
export function CompactFlow({
  spec,
  ariaLabel,
  laneHeader,
}: {
  spec: FlowSpec;
  ariaLabel: string;
  laneHeader?: ReactNode;
}) {
  return (
    <div className={styles.compact}>
      {laneHeader && <p className={styles.laneBar}>{laneHeader}</p>}
      <RouteFlowSvg spec={spec} ariaLabel={ariaLabel} />
    </div>
  );
}

/* ── The dossier: stat band + flow ── */

export default function RouteDossier({
  preview,
  verdict,
  slippagePercent,
}: {
  preview: SwapPreview;
  verdict: MandateVerdict | null;
  slippagePercent: number;
}) {
  const spec = useMemo(() => specFromPreview(preview), [preview]);
  const totals = useMemo(() => {
    const fees = spec.hops.reduce((a, h) => a + h.feeUsd, 0);
    const gas = spec.hops.reduce((a, h) => a + h.gasUsd, 0);
    return { fees, gas, cost: fees + gas };
  }, [spec]);
  const legDurations = spec.hops
    .map((h) => (h.durationSeconds !== null ? fmtDuration(h.durationSeconds) : null))
    .filter(Boolean)
    .join(' + ');
  const blocked = verdict ? !verdict.withinMandate : false;
  const breach = blocked ? RULE_META[verdict!.violations[0]!.rule] : null;
  const crossChain = preview.fromChain !== preview.toChain;
  const tradeClass = crossChain
    ? 'CROSS-CHAIN RELAY'
    : spec.hops.length > 1
      ? 'MULTI-LEG SWAP'
      : 'SAME-CHAIN SWAP';

  return (
    <section className={styles.panel} aria-label="Trade dossier: the priced route, leg by leg">
      <p className={styles.head}>
        <span className={styles.headTag}>TRADE CLASS</span>
        <span className={styles.headClass}>{tradeClass}</span>
        <span className={styles.headTitle}>
          {preview.fromToken.symbol} → {preview.toToken.symbol} ·{' '}
          {crossChain
            ? `${preview.fromChain.toUpperCase()} → ${preview.toChain.toUpperCase()}`
            : `ON ${preview.fromChain.toUpperCase()}`}{' '}
          · {spec.hops.length} {spec.hops.length === 1 ? 'LEG' : 'LEGS'}, {spec.hops.length + 1}{' '}
          TRANSFERS
        </span>
        <span className={styles.headId}>INDICATIVE · NOT EXECUTABLE</span>
      </p>

      <div className={styles.band}>
        <div className={styles.cellHeadline}>
          <span className={styles.cellLabel}>YOU SEND</span>
          <span className={styles.big}>
            {fmtAmount(preview.fromAmount)} {preview.fromToken.symbol}
          </span>
          <span className={styles.cellSub}>
            ≈ <b>{fmtUsd(preview.fromAmountUsd)}</b> on {preview.fromChain}
          </span>
        </div>
        <div className={styles.cell}>
          <span className={styles.cellLabel}>EST. RECEIVED</span>
          <span className={styles.valueGood}>
            {fmtAmount(preview.toAmount)} {preview.toToken.symbol}
          </span>
          <span className={styles.cellSub}>
            ≈ {fmtUsd(preview.toAmountUsd)} on {preview.toChain}
          </span>
        </div>
        <div className={styles.cell}>
          <span className={styles.cellLabel}>WORST-CASE FLOOR</span>
          <span className={styles.value}>
            ≥ {fmtAmount(preview.toAmountMin)} {preview.toToken.symbol}
          </span>
          <span className={styles.cellSub}>at your {slippagePercent}% slippage</span>
        </div>
        <div className={styles.cell}>
          <span className={styles.cellLabel}>THE ROUTE TAKES</span>
          <span className={styles.valueCost}>{fmtUsd(totals.cost)}</span>
          <span className={styles.cellSub}>
            fees {fmtUsd(totals.fees)} · gas {fmtUsd(totals.gas)} · impact {preview.priceImpact}%
          </span>
        </div>
        <div className={styles.cell}>
          <span className={styles.cellLabel}>SETTLES IN</span>
          <span className={styles.value}>{fmtDuration(preview.estimatedDurationSeconds)}</span>
          <span className={styles.cellSub}>{legDurations || 'single transaction'}</span>
        </div>
        <div className={styles.cell} data-verdict={blocked ? 'blocked' : verdict ? 'clear' : undefined}>
          <span className={styles.cellLabel}>MANDATE</span>
          <span className={blocked ? styles.valueBad : styles.valueGood} data-chip="">
            {verdict ? (breach ? `${breach.glyph} ${breach.heading}` : '● WITHIN MANDATE') : '-'}
          </span>
          <span className={styles.cellSub}>
            {blocked
              ? verdict!.violations.length === 1
                ? 'the one rule this trade breaks'
                : `first of ${verdict!.violations.length} rules this trade breaks`
              : 'every rule clear at this size'}
          </span>
        </div>
      </div>

      <p className={styles.sectionBar}>
        <span className={styles.sectionNum}>01</span> VALUE FLOW · {spec.hops.length + 2} NODES,{' '}
        {spec.hops.length + 1} TRANSFERS
      </p>
      <RouteFlowSvg
        spec={spec}
        ariaLabel={`Route flow: ${spec.source.amount} enters, ${spec.hops
          .map((h) => `${verb(h.type).toLowerCase()} via ${h.tool}`)
          .join(', then ')}, ${spec.out.amount} arrives. Fees and gas leave the path at each leg.`}
      />
      <p className={styles.footNote}>
        costs and timings are the aggregator's own estimates · nothing on this page can sign or send
      </p>
    </section>
  );
}
