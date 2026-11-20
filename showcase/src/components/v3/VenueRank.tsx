import Live from './Live';

/**
 * VenueRank: horizontal bars that grow in, then re-sort between three
 * arrangements (a quote race, ranking changes per request). Names are real
 * routing venues (pass from stats.routers); bar lengths are decorative and
 * unlabelled. Static (reduced motion / no JS) = the first, sorted arrangement.
 */
const STAGES = [
  [94, 82, 71, 63, 52, 44, 34],
  [66, 91, 56, 80, 38, 72, 47],
  [78, 58, 92, 48, 69, 40, 61],
];
const RH = 44; // row height, px

function order(scores: number[]) {
  return scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
}

export default function VenueRank({ venues }: { venues: string[] }) {
  const n = Math.min(venues.length, 7);
  const ranks = STAGES.map((st) => {
    const ord = order(st.slice(0, n));
    const rank: number[] = [];
    ord.forEach((idx, pos) => (rank[idx] = pos));
    return rank;
  });
  // static order = stage 0 sorted: venue i sits at rank ranks[0][i]
  return (
    <Live className="v3-rank">
      <div className="v3-rank__rows" style={{ height: n * RH }}>
        {venues.slice(0, n).map((name, i) => (
          <div
            key={name}
            className="v3-rank__row"
            style={
              {
                '--y0': `${ranks[0][i] * RH}px`,
                '--y1': `${ranks[1][i] * RH}px`,
                '--y2': `${ranks[2][i] * RH}px`,
                '--w0': STAGES[0][i] / 100,
                '--w1': STAGES[1][i] / 100,
                '--w2': STAGES[2][i] / 100,
                '--g': `${i * 0.09}s`,
                height: RH,
              } as React.CSSProperties
            }
          >
            <span className="v3-rank__name">{name}</span>
            <span className="v3-rank__track"><i className="v3-rank__bar" /></span>
          </div>
        ))}
      </div>
    </Live>
  );
}
