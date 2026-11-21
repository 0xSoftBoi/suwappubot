import Live from './Live';

/**
 * PipelineFlow: connected step flow (intent -> quote -> simulate -> authorize)
 * with a pulse travelling the track and nodes lighting in sequence.
 * Takes the existing step copy as props: `steps` = [{ number, title, body }].
 * Horizontal at >=900px, vertical below. Step text is real content (not
 * aria-hidden); only the track/pulse/glyphs are decorative.
 */
type Step = { number: string; title: string; body: string };

const GLYPHS = [
  // intent: target / crosshair
  <g key="a"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.2" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></g>,
  // quote: ranked bars
  <g key="b"><path d="M5 19V9M10 19V5M15 19v-7M20 19V8" /></g>,
  // simulate: flask
  <g key="c"><path d="M9 3h6M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3" /><path d="M7.5 15h9" /></g>,
  // authorize: seal / check
  <g key="d"><path d="M12 2.5 19 5v6.2c0 4.3-2.9 8-7 9.3-4.1-1.3-7-5-7-9.3V5z" /><path d="m8.8 12 2.4 2.4 4.2-4.6" /></g>,
];

export default function PipelineFlow({ steps }: { steps: Step[] }) {
  return (
    <div className="v3-flow">
      <Live className="v3-flow__track">
        <i className="v3-flow__line" />
        <i className="v3-flow__pulse" />
      </Live>
      <ol className="v3-flow__list">
      {steps.map((s, i) => (
        <li key={s.number} className="v3-flow__step" style={{ '--k': i } as React.CSSProperties}>
          <Live className="v3-flow__node">
            <span className="v3-flow__ring" />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{GLYPHS[i % 4]}</svg>
          </Live>
          <span className="v3-flow__num">{s.number}</span>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </li>
      ))}
      </ol>
    </div>
  );
}
