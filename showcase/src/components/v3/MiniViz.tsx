import Live from './Live';

/**
 * MiniViz: small bespoke pictograms for bento cards (SpotlightCard `visual`).
 * Stroke = currentColor (card visual slot sets it to --v3-cool); accent parts
 * use --v3-accent. 120x64 viewBox, all decorative.
 * kinds: route bridge book curve peg swap perps copy automate predict agent compete
 *   + meaning-specific: tee custody cipher gate simulate review window http402 meter calendar ladder
 */
export type MiniKind =
  | 'route' | 'bridge' | 'book' | 'curve' | 'peg' | 'swap'
  | 'perps' | 'copy' | 'automate' | 'predict' | 'agent' | 'compete'
  | 'tee' | 'custody' | 'cipher' | 'gate' | 'simulate' | 'review' | 'window' | 'http402' | 'meter' | 'calendar' | 'ladder' | 'services' | 'pages';

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
    case 'agent':
      return (<>
        <path d="M30,16 12,32 30,48M90,16 108,32 90,48" className="v3-draw" pathLength={100} />
        <path d="M52,50 68,14" stroke={A} />
        <circle cx="60" cy="32" r="3" fill={A} stroke="none" className="v3-breathe" />
      </>);
    case 'predict':
      return (<>
        <rect x="8" y="22" width="50" height="20" rx="4" fill={A} stroke="none" opacity="0.9" className="v3-pop" />
        <rect x="62" y="22" width="50" height="20" rx="4" opacity="0.6" />
        <text x="33" y="36" textAnchor="middle" fontSize="9" stroke="none" fill="var(--v3-bg, #111)" style={{ fontFamily: 'var(--v3-font-mono)', letterSpacing: '0.1em' }}>YES</text>
        <text x="87" y="36" textAnchor="middle" fontSize="9" stroke="none" fill="currentColor" style={{ fontFamily: 'var(--v3-font-mono)', letterSpacing: '0.1em' }}>NO</text>
      </>);
    case 'compete':
      return (<>
        {[0, 1, 2, 3].map((i) => <g key={i} className="v3-pop" style={D(i * 0.12)}>
          <path d={`M14,${48 - i * 12}H${40 + i * 6}`} stroke={i === 3 ? A : 'currentColor'} opacity={i === 3 ? 1 : 0.55} />
          <circle cx="10" cy={48 - i * 12} r="2.5" fill={i === 3 ? A : 'none'} stroke={i === 3 ? A : 'currentColor'} />
        </g>)}
        <path d="M80,50 94,34 106,40 114,14" stroke={A} className="v3-draw" pathLength={100} />
      </>);
    case 'tee':
      return (<>
        <rect x="30" y="8" width="60" height="48" rx="6" strokeDasharray="4 4" opacity="0.7" />
        <circle cx="52" cy="32" r="7" stroke={A} /><path d="M59,32H78M72,32v6M78,32v5" stroke={A} />
        <circle cx="60" cy="32" r="27" opacity="0.35" className="v3-pop" />
        <path d="M12,32H26m-4,-4 4,4-4,4" opacity="0.5" />
      </>);
    case 'custody':
      return (<>
        <circle cx="60" cy="32" r="4" fill={A} stroke="none" />
        <path d="M60,32 C44,32 40,14 22,14M60,32 C44,32 40,50 22,50" pathLength={100} className="v3-draw" />
        <rect x="8" y="8" width="18" height="12" rx="3" /><rect x="8" y="44" width="18" height="12" rx="3" stroke={A} />
        <path d="M70,32H112m-6,-5 6,5-6,5" opacity="0.5" />
      </>);
    case 'cipher':
      return (<>
        <rect x="8" y="14" width="46" height="36" rx="4" />
        <path d="M16,26H46M16,34H40M16,42H44" opacity="0.5" strokeDasharray="2 3" />
        <path d="M58,32H72m-4,-4 4,4-4,4" opacity="0.6" />
        <rect x="76" y="14" width="36" height="36" rx="4" stroke={A} />
        <circle cx="90" cy="32" r="5" stroke={A} /><path d="M95,32H104M100,32v5" stroke={A} />
      </>);
    case 'gate':
      return (<>
        <path d="M6,32H38M82,32H114m-6,-5 6,5-6,5" className="v3-draw" pathLength={100} />
        <path d="M42,8V56M78,8V56" stroke={A} />
        <path d="M46,18h28M46,28h20M46,38h24M46,48h16" opacity="0.5" strokeDasharray="2 3" />
        <circle cx="14" cy="32" r="3" fill="currentColor" stroke="none" />
      </>);
    case 'simulate':
      return (<>
        <path d="M6,48 C26,48 30,24 54,24" pathLength={100} className="v3-draw" /><path d="M66,24 C90,24 96,14 114,14" pathLength={100} className="v3-draw" style={D(0.4)} />
        <rect x="52" y="8" width="16" height="32" rx="3" stroke={A} strokeDasharray="3 3" />
        <path d="M57,24l3.5,3.5 5,-6" stroke={A} />
        <text x="60" y="56" textAnchor="middle" fontSize="7" stroke="none" fill="currentColor" opacity="0.7" style={{ fontFamily: 'var(--v3-font-mono)', letterSpacing: '0.12em' }}>SIMULATE</text>
      </>);
    case 'review':
      return (<>
        {[0, 1, 2].map((i) => <g key={i} className="v3-pop" style={D(i * 0.15)}>
          <path d={`M8,${14 + i * 18}H56`} opacity="0.55" strokeDasharray="3 3" />
          <path d={`M64,${14 + i * 18}H84`} opacity="0.55" /><path d={`M88,${14 + i * 18}l4,4 8,-9`} stroke={A} />
        </g>)}
      </>);
    case 'window':
      return (<>
        <path d="M8,14H112M8,32H112M8,50H112" opacity="0.3" />
        <rect x="40" y="6" width="44" height="52" rx="4" stroke={A} strokeDasharray="3 3" />
        {[[10, 14], [50, 14], [24, 32], [62, 32], [14, 50], [74, 50]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.6" fill={x > 38 && x < 86 ? A : 'currentColor'} stroke="none" opacity={x > 38 && x < 86 ? 1 : 0.5} />)}
      </>);
    case 'http402':
      return (<>
        <path d="M8,20H70m-6,-5 6,5-6,5" className="v3-draw" pathLength={100} />
        <path d="M112,44H50m6,-5-6,5 6,5" stroke={A} className="v3-draw" pathLength={100} style={D(0.4)} />
        <text x="8" y="12" fontSize="8" stroke="none" fill="currentColor" opacity="0.7" style={{ fontFamily: 'var(--v3-font-mono)', letterSpacing: '0.1em' }}>GET</text>
        <text x="112" y="60" textAnchor="end" fontSize="8" stroke="none" fill={A} style={{ fontFamily: 'var(--v3-font-mono)', letterSpacing: '0.1em' }}>402</text>
      </>);
    case 'meter':
      return (<>
        <path d="M18,50 A38,38 0 0 1 102,50" opacity="0.4" />
        <path d="M18,50 A38,38 0 0 1 80,19" stroke={A} pathLength={100} className="v3-draw" />
        <path d="M60,50 80,26" stroke={A} /><circle cx="60" cy="50" r="3.5" fill={A} stroke="none" />
      </>);
    case 'calendar':
      return (<>
        <rect x="10" y="12" width="100" height="42" rx="5" opacity="0.6" />
        <path d="M10,24H110" opacity="0.6" />
        {Array.from({ length: 10 }, (_, i) => <rect key={i} x={16 + i * 9.4} y="32" width="6" height="14" rx="1.5" fill={i < 6 ? A : 'none'} stroke={i < 6 ? A : 'currentColor'} opacity={i < 6 ? 0.9 : 0.45} />)}
      </>);
    case 'ladder':
      return (<>
        {[0, 1, 2, 3].map((i) => <rect key={i} x={10 + i * 26} y={46 - i * 11} width="20" height={10 + i * 11} rx="2.5" fill={i === 3 ? A : 'none'} stroke={i === 3 ? A : 'currentColor'} className="v3-pop" style={D(i * 0.12)} />)}
      </>);
    case 'services':
      // service nodes joined by one line; hollow dots = "no reading drawn", never a history
      return (<>
        <path d="M14,32H106" opacity="0.4" strokeDasharray="2 4" />
        {[14, 37, 60, 83, 106].map((x, i) => <g key={x} className="v3-pop" style={D(i * 0.12)}><circle cx={x} cy="32" r="8" fill="var(--v3-surface-hi)" opacity="0.9" /><circle cx={x} cy="32" r="2.6" opacity="0.7" /></g>)}
      </>);
    case 'pages':
      // stacked sheets with rule lines: written material, not a chart
      return (<>
        <rect x="30" y="8" width="60" height="46" rx="4" opacity="0.3" />
        <rect x="24" y="12" width="60" height="46" rx="4" opacity="0.55" fill="var(--v3-surface-hi)" />
        <rect x="18" y="16" width="60" height="44" rx="4" fill="var(--v3-surface-hi)" />
        {[26, 33, 40].map((y, i) => <path key={y} d={`M26,${y}H${i === 2 ? 48 : 70}`} pathLength={100} className="v3-draw" style={D(i * 0.2)} />)}
        <path d="M26,48H40" stroke={A} />
      </>);
  }
}

export default function MiniViz({ kind }: { kind: MiniKind }) {
  return (
    <Live className="v3-mini">
      <svg viewBox="0 0 120 64" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" role="presentation" focusable="false">
        <Art kind={kind} />
      </svg>
    </Live>
  );
}
