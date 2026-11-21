import type { CSSProperties } from 'react';
import Live from './Live';

/**
 * ExecutionPlane: system schematic. Interface surfaces converge on a staged
 * pipeline (intent -> ... -> settle); a dashed provider dependency hangs off
 * the routing stage and the authorize stage forks into the two custody modes.
 * Labels are caller-supplied nouns (no numbers). Two layouts (wide / stacked)
 * are both rendered and swapped in CSS (.v3-ep--wide / .v3-ep--tall).
 *
 *   <ExecutionPlane surfaces={[a,b,c]} stages={[5 labels]} custody={[a,b]} provider="Providers" />
 */
const D = (s: number) => ({ '--v3-d': `${s}s` }) as CSSProperties;
const MONO = { fontFamily: 'var(--v3-font-mono)', letterSpacing: '0.06em' } as const;
const LINE = 'var(--v3-line-strong)';

type P = { surfaces: string[]; stages: string[]; custody: string[]; provider: string };

function Box({ x, y, w, h = 40, t, d, hot, dashed }: { x: number; y: number; w: number; h?: number; t: string; d: number; hot?: boolean; dashed?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" fill="var(--v3-surface-hi)" stroke={hot ? 'var(--v3-accent)' : LINE} strokeWidth={hot ? 1.6 : 1} strokeDasharray={dashed ? '4 4' : undefined} className="v3-pop" style={D(d)} />
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize="12" fill={hot ? 'var(--v3-accent)' : 'var(--v3-ink)'} style={MONO}>{t.toUpperCase()}</text>
    </g>
  );
}
function Wire({ d, t, dashed, pulse }: { d: string; t: number; dashed?: boolean; pulse?: boolean }) {
  return (
    <>
      <path d={d} stroke={LINE} strokeDasharray={dashed ? '4 4' : undefined} pathLength={dashed ? undefined : 100} className={dashed ? undefined : 'v3-draw'} style={D(t)} />
      {pulse && <path d={d} pathLength={100} className="v3-pulse" style={{ ...D(t), strokeWidth: 2.5 }} />}
    </>
  );
}

function Wide({ surfaces, stages, custody, provider }: P) {
  const sx = (i: number) => 200 + i * 135;
  return (
    <svg viewBox="0 20 860 270" role="presentation" focusable="false" fill="none">
      <rect x="176" y="62" width="684" height="118" rx="18" stroke={LINE} strokeDasharray="2 5" />
      {surfaces.map((s, i) => (
        <g key={s}>
          <Box x={0} y={30 + i * 56} w={142} t={s} d={i * 0.15} />
          <Wire d={`M142,${50 + i * 56}C176,${50 + i * 56} 168,121 ${sx(0)},121`} t={0.4 + i * 0.15} pulse={i === 1} />
        </g>
      ))}
      {stages.map((s, i) => (
        <g key={s}>
          {i > 0 && <Wire d={`M${sx(i - 1) + 110},121H${sx(i)}`} t={0.5 + i * 0.25} pulse />}
          <Box x={sx(i)} y={100} w={110} t={s} d={0.3 + i * 0.2} hot={i === 3} />
        </g>
      ))}
      <Wire d={`M${sx(1) + 55},140V232`} t={0} dashed />
      <Box x={sx(1) - 12} y={232} w={134} t={provider} d={1.2} dashed />
      <Wire d={`M${sx(3) + 55},140V196H${sx(3) - 40}V232`} t={1.2} />
      <Wire d={`M${sx(3) + 55},196H${sx(3) + 150}V232`} t={1.2} />
      <Box x={sx(3) - 110} y={232} w={140} t={custody[0]} d={1.5} />
      <Box x={sx(3) + 90} y={232} w={140} t={custody[1]} d={1.6} hot />
    </svg>
  );
}

function Tall({ surfaces, stages, custody, provider }: P) {
  const sy = (i: number) => 128 + i * 88;
  return (
    <svg viewBox="0 0 360 570" role="presentation" focusable="false" fill="none">
      <rect x="10" y="96" width="196" height="468" rx="18" stroke={LINE} strokeDasharray="2 5" />
      {surfaces.map((s, i) => (
        <g key={s}>
          <Box x={i * 124} y={0} w={112} h={36} t={s.split(' / ')[0]} d={i * 0.15} />
          <Wire d={`M${i * 124 + 56},36C${i * 124 + 56},80 108,70 108,${sy(0)}`} t={0.4 + i * 0.15} pulse={i === 1} />
        </g>
      ))}
      {stages.map((s, i) => (
        <g key={s}>
          {i > 0 && <Wire d={`M108,${sy(i - 1) + 40}V${sy(i)}`} t={0.5 + i * 0.25} pulse />}
          <Box x={38} y={sy(i)} w={140} t={s} d={0.3 + i * 0.2} hot={i === 3} />
        </g>
      ))}
      <Wire d={`M178,${sy(1) + 20}H226`} t={0} dashed />
      <Box x={226} y={sy(1)} w={128} t={provider} d={1.2} dashed />
      <Wire d={`M178,${sy(3) + 20}H198V${sy(3) - 14}H226`} t={1.2} />
      <Wire d={`M198,${sy(3) + 20}V${sy(3) + 54}H226`} t={1.2} />
      <Box x={226} y={sy(3) - 32} w={128} h={36} t={custody[0]} d={1.5} />
      <Box x={226} y={sy(3) + 36} w={128} h={36} t={custody[1]} d={1.6} hot />
    </svg>
  );
}

export default function ExecutionPlane(p: P) {
  return (
    <>
      <Live className="v3-ep v3-ep--wide"><Wide {...p} /></Live>
      <Live className="v3-ep v3-ep--tall"><Tall {...p} /></Live>
    </>
  );
}
