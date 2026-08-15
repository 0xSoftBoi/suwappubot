/**
 * "Journey" atmospheric backdrop: a No Man's Sky cosmos at the top of the page
 * that gradients, as you scroll, down through the atmosphere into the Suwappu
 * brand world on the ground: Mount Fuji, the ocean, rolling waves, and drifting
 * sakura petals. Persimmon + teal palette.
 *
 * Anchored to the document (absolute, full page height: NOT fixed) so scrolling
 * is a top-to-bottom descent: space → alien sky → dawn horizon → sea. It sits at
 * z-index 0, behind `.summer-shell` content (z-index 1). Pure CSS, no images, no
 * JS loop. All motion stops under `prefers-reduced-motion`.
 *
 * Top zone (space):  drifting stars, nebula clouds, a ringed planet + a moon
 * Mid (atmosphere):  the page gradient morphs lavender → peach dawn → teal
 * Ground zone:       cloud bands, Mount Fuji, horizon mist, ocean + seigaiha
 *                    waves, sun-reflection shimmer, and falling sakura petals
 */

// Sakura petals live in the lower "ground" half of the journey. Each gets its
// own column, drift, size, and timing via inline custom properties.
const PETALS = [
  { left: '8%', delay: '0s', dur: '15s', scale: 1.0, hue: 'blush' },
  { left: '19%', delay: '6s', dur: '19s', scale: 0.7, hue: 'sun' },
  { left: '30%', delay: '10s', dur: '16s', scale: 1.2, hue: 'blush' },
  { left: '41%', delay: '3s', dur: '21s', scale: 0.85, hue: 'pale' },
  { left: '52%', delay: '13s', dur: '15s', scale: 1.05, hue: 'sun' },
  { left: '63%', delay: '7s', dur: '23s', scale: 0.75, hue: 'blush' },
  { left: '73%', delay: '1s', dur: '17s', scale: 1.15, hue: 'pale' },
  { left: '83%', delay: '9s', dur: '20s', scale: 0.9, hue: 'blush' },
  { left: '91%', delay: '5s', dur: '16s', scale: 1.0, hue: 'sun' },
  { left: '46%', delay: '17s', dur: '24s', scale: 0.65, hue: 'pale' },
  { left: '14%', delay: '14s', dur: '22s', scale: 0.95, hue: 'blush' },
  { left: '68%', delay: '19s', dur: '18s', scale: 1.1, hue: 'sun' },
];

export default function CosmicAtmosphere() {
  return (
    <div className="journey" aria-hidden="true">
      {/* ── space (top) ── */}
      <div className="journey__space">
        <div className="journey__stars journey__stars--far" />
        <div className="journey__stars journey__stars--near" />
        <div className="journey__nebula journey__nebula--a" />
        <div className="journey__nebula journey__nebula--b" />
        <div className="journey__planet">
          <span className="journey__planet-ring" />
        </div>
        <div className="journey__moon" />
      </div>

      {/* ── ground (bottom) ── */}
      <div className="journey__ground">
        <div className="journey__clouds journey__clouds--far" />
        <div className="journey__clouds journey__clouds--near" />
        <div className="journey__fuji">
          <span className="journey__fuji-snow" />
        </div>
        <div className="journey__mist" />
        <div className="journey__sea" />
        <div className="journey__shimmer" />
      </div>

      {/* ── sakura, drifting over the lower half ── */}
      <div className="journey__petals">
        {PETALS.map((p, i) => (
          <span
            key={i}
            className={`journey__petal journey__petal--${p.hue}`}
            style={
              {
                left: p.left,
                '--delay': p.delay,
                '--dur': p.dur,
                '--scale': String(p.scale),
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* ── film grain over the whole backdrop (the "premium" tell) ── */}
      <div className="journey__grain" />
    </div>
  );
}
