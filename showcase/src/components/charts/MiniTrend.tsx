import './charts.css';

/** MiniTrend: tiny decorative area trend from a real daily series (no axes, no values). */
export default function MiniTrend({ values, width = 96, height = 30 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2 || values.every((v) => v === values[0])) return null;
  const hi = Math.max(...values), lo = Math.min(...values), span = hi - lo || 1;
  const px = (i: number) => (i / (values.length - 1)) * width;
  const py = (v: number) => 2 + (1 - (v - lo) / span) * (height - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  return (
    <svg className="ch-mini" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <path d={`${d} L${width},${height} L0,${height} Z`} className="ch-mini__area" />
      <path d={d} pathLength={1} className="ch-mini__line" />
    </svg>
  );
}
