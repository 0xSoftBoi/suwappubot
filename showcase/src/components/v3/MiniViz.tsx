import Live from './Live';

/**
 * MiniViz: small bespoke pictograms for bento cards (SpotlightCard `visual`).
 * Stroke = currentColor (card visual slot sets it to --v3-cool); accent parts
 * use --v3-accent. 120x64 viewBox, all decorative.
 * kinds: route bridge book curve peg swap perps copy automate predict agent compete
 */
export type MiniKind =
  | 'route' | 'bridge' | 'book' | 'curve' | 'peg' | 'swap'
  | 'perps' | 'copy' | 'automate' | 'predict' | 'agent' | 'compete';

const A = 'var(--v3-accent)';
const D = (s: number) => ({ '--v3-d': `${s}s` }) as React.CSSProperties;

function Art({ kind }: { kind: MiniKind }) {
  switch (kind) {
    case 'route':
      return (<>
        <path d="M14,48 C40,48 44,18 70,18 S100,36 106,16" pathLength={100} className="v3-draw" />
        <path d="M14,48 C40,48 44,18 70,18 S100,36 106,16" pathLength={100} className="v3-pulse" style={{ strokeWidth: 3 }} />
        {[[14, 48], [70, 18], [106, 16]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill="var(--v3-surface-hi)" className="v3-pop" style={D(i * 0.2)} />)}
      </>);
    case 'bridge':
      return (<>
        <path d="M8,52V30M32,52V30M88,52V30M112,52V30M8,52H112" />
        <path d="M32,30 C48,6 72,6 88,30" pathLength={100} stroke={A} className="v3-draw" />
        <path d="M32,30 C48,6 72,6 88,30" pathLength={100} className="v3-pulse" style={{ strokeWidth: 3 }} />
      </>);
    case 'book':
      return (<g strokeWidth="5" strokeLinecap="round">
        {[0, 1, 2, 3].map((i) => <path key={'a' + i} d={`M60,${8 + i * 9}H${60 - (40 - i * 8)}`} stroke="color-mix(in srgb, var(--v3-ink) 35%, transparent)" className="v3-draw" style={D(i * 0.12)} pathLength={100} />)}
        {[0, 1, 2, 3].map((i) => <path key={'b' + i} d={`M64,${40 + i * 9 - 8}H${64 + (14 + i * 9)}`} stroke={A} opacity={0.9 - i * 0.15} className="v3-draw" style={D(0.4 + i * 0.12)} pathLength={100} />)}
      </g>);
    case 'curve':
      return (<>
        <path d="M10,10 C14,46 34,52 110,54" pathLength={100} className="v3-draw" />
        <path d="M10,10 C14,46 34,52 110,54" pathLength={100} className="v3-pulse" style={{ strokeWidth: 3 }} />
        <circle cx="38" cy="49" r="4" fill={A} stroke="none" className="v3-pop" style={D(0.6)} />
        <path d="M10,60H112M10,6V60" opacity="0.35" />
      </>);
    case 'peg':
      return (<>
        <circle cx="22" cy="32" r="13" /><circle cx="98" cy="32" r="13" />
        <path d="M35,32H85" strokeDasharray="3 5" stroke={A} />
        <path d="M54,27H66M54,37H66" stroke={A} />
      </>);
    case 'swap':
      return (<>
        <circle cx="24" cy="32" r="13" /><circle cx="96" cy="32" r="13" />
        <path d="M42,25H78m-6,-6 6,6-6,6M78,39H42m6,-6-6,6 6,6" stroke={A} className="v3-draw" pathLength={100} />
      </>);
    case 'perps':
      return (<g>
        {[[16, 34, 14], [32, 26, 18], [48, 30, 12], [64, 14, 22], [80, 20, 14], [96, 8, 20]].map(([x, y, h], i) => (
          <g key={i} className="v3-pop" style={D(i * 0.1)}>
            <path d={`M${x},${y - 6}V${y + h + 6}`} opacity="0.5" />
            <rect x={x - 4} y={y} width="8" height={h} rx="1.5" fill={i % 3 === 2 ? 'transparent' : A} stroke={i % 3 === 2 ? 'currentColor' : A} />
          </g>))}
      </g>);
    case 'copy':
      return (<>
        <path d="M10,44 L30,30 L50,38 L70,14" pathLength={100} className="v3-draw" />
        <path d="M10,54 L30,40 L50,48 L70,24" stroke={A} pathLength={100} className="v3-draw" style={D(0.5)} strokeDasharray="3 4" />
        <path d="M80,32h30m-6,-6 6,6-6,6" opacity="0.6" />
      </>);
    case 'automate':
      return (<>
        <circle cx="34" cy="32" r="20" />
        <path d="M34,18V32L44,38" stroke={A} className="v3-draw" pathLength={100} />
        <path d="M68,20H112M68,32H100M68,44H108" opacity="0.55" strokeLinecap="round" />
      </>);
    case 'predict':
      return (<>
        <rect x="8" y="24" width="104" height="16" rx="8" opacity="0.4" />
        <rect x="8" y="24" width="64" height="16" rx="8" fill={A} stroke="none" opacity="0.9" className="v3-pop" />
        <path d="M72,14V50" strokeDasharray="2 3" />
      </>);
    case 'agent':
      return (<>
        <path d="M30,16 12,32 30,48M90,16 108,32 90,48" className="v3-draw" pathLength={100} />
        <path d="M52,50 68,14" stroke={A} />
        <circle cx="60" cy="32" r="3" fill={A} stroke="none" className="v3-breathe" />
      </>);
    case 'compete':
      return (<g>
        {[[18, 34, 'a'], [48, 14, 'b'], [78, 26, 'c']].map(([x, y], i) => (
          <rect key={i} x={x as number} y={y as number} width="24" height={56 - (y as number)} rx="3" fill={i === 1 ? A : 'transparent'} stroke={i === 1 ? A : 'currentColor'} className="v3-pop" style={D(i * 0.15)} />))}
      </g>);
  }
}

export default function MiniViz({ kind }: { kind: MiniKind }) {
  return (
    <Live className="v3-mini">
      <svg viewBox="0 0 120 64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" role="presentation" focusable="false">
        <Art kind={kind} />
      </svg>
    </Live>
  );
}
