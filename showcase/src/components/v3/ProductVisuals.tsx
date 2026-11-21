import stats from '@/data/stats.generated.json';
import RouteMap from './RouteMap';
import VenueRank from './VenueRank';
import ToolOrbit from './ToolOrbit';
import BoundaryRings from './BoundaryRings';
import ProductFrame from './ProductFrame';

/**
 * Product-page schematics. One `visual` key -> one small graphic. Kit graphics
 * are reused where they fit; the rest are drawn here as inline SVG. All are
 * aria-hidden, equal/ordinal marks only (no data), and static under reduced
 * motion (styles: product-deep.css, `pvx-`). Unknown keys fall back to a
 * neutral backdrop.
 */
const rankVenues = stats.routers.filter((r) => !/[_0-9]/.test(r)).slice(0, 6);

type G = { children: React.ReactNode };
const Svg = ({ children }: G) => (
  <svg className="pvx" viewBox="0 0 320 220" fill="none" aria-hidden="true" focusable="false">{children}</svg>
);
const T = ({ x, y, children, anchor = 'start' }: { x: number; y: number; children: string; anchor?: 'start' | 'middle' | 'end' }) => (
  <text className="pvx-txt" x={x} y={y} textAnchor={anchor}>{children}</text>
);

function OrderLadder() {
  const ys = [34, 68, 102, 136, 170];
  return (
    <Svg>
      <line className="pvx-dim" x1="60" y1="20" x2="60" y2="190" />
      {ys.map((y, i) => (
        <g key={y}>
          <line className={i === 1 ? 'pvx-acc' : 'pvx-dim'} x1="52" y1={y} x2="68" y2={y} />
          <rect className={i === 1 ? 'pvx-solid' : 'pvx-box'} x="84" y={y - 9} width="200" height="18" rx="9" />
        </g>
      ))}
      <line className="pvx-acc pvx-dash" x1="40" y1="102" x2="296" y2="102" />
      <T x={92} y={72}>TRIGGER</T>
      <T x={92} y={106}>PRICE</T>
      <circle className="pvx-dot pvx-travel" cx="60" cy="34" r="5" />
      <path className="pvx-acc" d="M296 54l-6 8h12zM296 150l-6-8h12z" />
    </Svg>
  );
}

function AlertPulse() {
  return (
    <Svg>
      <path className="pvx-dim" d="M20 150 L70 150 L100 120 L130 140 L170 90 L200 110 L240 70 L300 70" />
      <line className="pvx-acc pvx-dash" x1="20" y1="90" x2="300" y2="90" />
      <T x={22} y={82}>THRESHOLD</T>
      <circle className="pvx-ring pvx-ping" cx="170" cy="90" r="10" />
      <circle className="pvx-ring pvx-ping pvx-ping--b" cx="170" cy="90" r="10" />
      <circle className="pvx-dot" cx="170" cy="90" r="6" />
      <rect className="pvx-box" x="196" y="148" width="104" height="36" rx="10" />
      <rect className="pvx-solid" x="208" y="160" width="10" height="12" rx="3" />
      <line className="pvx-dim" x1="226" y1="162" x2="288" y2="162" />
      <line className="pvx-dim" x1="226" y1="172" x2="268" y2="172" />
    </Svg>
  );
}

function CopyMirror() {
  const ys = [50, 96, 142];
  return (
    <Svg>
      <line className="pvx-dim pvx-dash" x1="160" y1="22" x2="160" y2="196" />
      <T x={48} y={30}>LEADER</T>
      <T x={272} y={30} anchor="end">YOU</T>
      {ys.map((y, i) => (
        <g key={y}>
          <rect className="pvx-box" x="30" y={y} width="90" height="28" rx="8" />
          <rect className="pvx-solid" x="30" y={y} width="90" height="28" rx="8" style={{ opacity: 0.18 + i * 0.1 }} />
          <line className="pvx-acc" x1="126" y1={y + 14} x2="194" y2={y + 14} />
          <path className="pvx-acc" d={`M188 ${y + 9}l8 5-8 5`} />
          <rect className="pvx-box" x="200" y={y} width="90" height="28" rx="8" />
          <rect className="pvx-solid" x="200" y={y} width="90" height="28" rx="8" style={{ opacity: 0.18 + i * 0.1 }} />
        </g>
      ))}
    </Svg>
  );
}

function LaunchRadar() {
  return (
    <Svg>
      <g transform="translate(160 110)">
        {[88, 62, 36].map((r) => <circle key={r} className="pvx-dim" r={r} />)}
        <line className="pvx-dim" x1="-96" x2="96" /><line className="pvx-dim" y1="-96" y2="96" />
        <g className="pvx-sweep"><path className="pvx-wedge" d="M0 0 L88 0 A88 88 0 0 0 62 -62 Z" /><line className="pvx-acc" x2="88" /></g>
        <circle className="pvx-dot pvx-blink" cx="42" cy="-30" r="5" />
        <circle className="pvx-dot pvx-blink pvx-blink--b" cx="-34" cy="26" r="4" />
        <circle className="pvx-dot pvx-blink pvx-blink--c" cx="14" cy="52" r="4" />
      </g>
      <T x={252} y={46}>NEW POOL</T>
    </Svg>
  );
}

function PerpLadder() {
  const asks = [150, 126, 102, 80];
  const bids = [80, 102, 126, 150];
  return (
    <Svg>
      <T x={160} y={22} anchor="middle">ASKS</T>
      {asks.map((w, i) => <rect key={`a${i}`} className="pvx-box pvx-ask" x={160 - w / 2} y={32 + i * 20} width={w} height="14" rx="4" />)}
      <line className="pvx-acc pvx-dash" x1="30" y1="118" x2="290" y2="118" />
      <T x={160} y={134} anchor="middle">SPREAD</T>
      {bids.map((w, i) => <rect key={`b${i}`} className="pvx-solid pvx-bid" x={160 - w / 2} y={142 + i * 18} width={w} height="12" rx="4" />)}
      <rect className="pvx-box" x="30" y="40" width="46" height="22" rx="11" /><T x={53} y={55} anchor="middle">SHORT</T>
      <rect className="pvx-solid" x="244" y="150" width="46" height="22" rx="11" style={{ opacity: 0.35 }} /><T x={267} y={165} anchor="middle">LONG</T>
    </Svg>
  );
}

function OddsBar() {
  return (
    <Svg>
      {[52, 100, 148].map((y, i) => (
        <g key={y}>
          <rect className="pvx-box" x="30" y={y} width="260" height="26" rx="13" />
          <rect className="pvx-solid" x="30" y={y} width="130" height="26" rx="13" style={{ opacity: 0.4 + (i === 0 ? 0.3 : 0) }} />
          <T x={48} y={y + 17}>YES</T>
          <T x={272} y={y + 17} anchor="end">NO</T>
          <circle className="pvx-knob" cx="160" cy={y + 13} r="9" />
        </g>
      ))}
      <T x={160} y={30} anchor="middle">MARKET</T>
    </Svg>
  );
}

function KeyVault() {
  return (
    <Svg>
      <rect className="pvx-dim pvx-dash" x="40" y="26" width="240" height="168" rx="22" />
      <T x={58} y={48}>KMS</T>
      <rect className="pvx-box" x="84" y="62" width="152" height="108" rx="16" />
      <circle className="pvx-solid" cx="160" cy="106" r="16" style={{ opacity: 0.25 }} />
      <circle className="pvx-acc" cx="160" cy="106" r="16" />
      <path className="pvx-acc" d="M160 114v18" />
      <T x={160} y={158} anchor="middle">KEY</T>
      <circle className="pvx-dot pvx-travel pvx-orbit" cx="40" cy="110" r="4" />
    </Svg>
  );
}

function ChatCommands() {
  const cmds: [string, number][] = [['/s', 30], ['/w', 76], ['/b', 122], ['/a', 168]];
  return (
    <Svg>
      {cmds.map(([c, y], i) => (
        <g key={c}>
          <rect className="pvx-solid" x="200" y={y} width="90" height="28" rx="12" style={{ opacity: 0.85 - i * 0.05 }} />
          <text className="pvx-cmd" x="245" y={y + 19} textAnchor="middle">{c}</text>
          <rect className="pvx-box" x="30" y={y + 4} width={110 - (i % 2) * 24} height="20" rx="10" />
        </g>
      ))}
    </Svg>
  );
}

function SdkStack() {
  const labels = ['REST', 'Python', 'TypeScript'];
  return (
    <Svg>
      {labels.map((l, i) => (
        <g key={l} transform={`translate(${i * 14} ${-i * 44})`}>
          <path className={i === 2 ? 'pvx-solid' : 'pvx-box'} d="M40 168 L150 168 L270 168 L230 202 L40 202 Z" style={i === 2 ? { opacity: 0.35 } : undefined} />
          <path className="pvx-acc" d="M40 168 L270 168 L230 202 L40 202 Z" />
          <T x={62} y={190}>{l}</T>
        </g>
      ))}
      <line className="pvx-acc pvx-dash" x1="40" y1="30" x2="40" y2="160" />
    </Svg>
  );
}

function ApprovalTimeline() {
  const nodes = ['REQUEST', 'APPROVE', 'AUDIT'];
  return (
    <Svg>
      <line className="pvx-dim" x1="40" y1="110" x2="280" y2="110" />
      <line className="pvx-acc pvx-travel-line" x1="40" y1="110" x2="280" y2="110" />
      {nodes.map((n, i) => (
        <g key={n}>
          <circle className={i === 1 ? 'pvx-solid' : 'pvx-box'} cx={40 + i * 120} cy="110" r="14" />
          <T x={40 + i * 120} y={150} anchor="middle">{n}</T>
          <T x={40 + i * 120} y={114} anchor="middle">{String(i + 1)}</T>
        </g>
      ))}
      <rect className="pvx-box" x="104" y="40" width="112" height="30" rx="10" />
      <T x={160} y={59} anchor="middle">STEP-UP</T>
      <line className="pvx-dim pvx-dash" x1="160" y1="70" x2="160" y2="96" />
    </Svg>
  );
}

function OrgTree() {
  return (
    <Svg>
      <rect className="pvx-solid" x="120" y="24" width="80" height="30" rx="10" style={{ opacity: 0.3 }} />
      <rect className="pvx-acc" x="120" y="24" width="80" height="30" rx="10" />
      <T x={160} y={43} anchor="middle">ORG</T>
      <path className="pvx-dim" d="M160 54v26M60 80h200M60 80v26M160 80v26M260 80v26" />
      {[20, 120, 220].map((x) => (
        <g key={x}>
          <rect className="pvx-box" x={x} y="106" width="80" height="28" rx="9" />
          <T x={x + 40} y={124} anchor="middle">MEMBER</T>
          <path className="pvx-dim" d={`M${x + 40} 134v22`} />
          <rect className="pvx-solid" x={x + 22} y="156" width="36" height="22" rx="7" style={{ opacity: 0.35 }} />
          <T x={x + 40} y={171} anchor="middle">KEY</T>
        </g>
      ))}
    </Svg>
  );
}

function CreditMeter() {
  return (
    <Svg>
      <T x={30} y={52}>CREDITS</T>
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} className={i < 6 ? 'pvx-solid' : 'pvx-box'} x={30 + i * 26} y="64" width="20" height="54" rx="5" style={i < 6 ? { opacity: 0.25 + i * 0.1 } : undefined} />
      ))}
      <path className="pvx-acc" d="M30 146h240" />
      <path className="pvx-acc pvx-drain" d="M200 146l8 10M208 146l8 10" />
      <rect className="pvx-box" x="30" y="162" width="64" height="24" rx="12" /><T x={62} y={178} anchor="middle">QUOTE</T>
      <rect className="pvx-solid" x="104" y="162" width="64" height="24" rx="12" style={{ opacity: 0.3 }} /><T x={136} y={178} anchor="middle">SWAP</T>
    </Svg>
  );
}

function PaperLedger() {
  return (
    <Svg>
      <rect className="pvx-box" x="50" y="22" width="220" height="176" rx="14" />
      {[56, 88, 120, 152].map((y, i) => (
        <g key={y}>
          <circle className={i % 2 ? 'pvx-dim' : 'pvx-acc'} cx="76" cy={y} r="5" />
          <line className="pvx-dim" x1="94" y1={y} x2={244 - i * 18} y2={y} />
        </g>
      ))}
      <g transform="rotate(-14 160 110)">
        <rect className="pvx-acc" x="104" y="92" width="112" height="36" rx="8" />
        <text className="pvx-stamp" x="160" y="117" textAnchor="middle">PAPER</text>
      </g>
    </Svg>
  );
}

function VerdictCard() {
  return (
    <Svg>
      <rect className="pvx-box" x="40" y="22" width="240" height="176" rx="16" />
      <T x={58} y={46}>HASH-PINNED WASM</T>
      <line className="pvx-dim" x1="58" y1="58" x2="262" y2="58" />
      <circle className="pvx-solid" cx="160" cy="104" r="24" style={{ opacity: 0.25 }} />
      <circle className="pvx-acc" cx="160" cy="104" r="24" />
      <path className="pvx-acc" d="M148 104l9 9 16-18" />
      <rect className="pvx-solid" x="58" y="152" width="94" height="28" rx="14" style={{ opacity: 0.35 }} /><T x={105} y={170} anchor="middle">RELEASE</T>
      <rect className="pvx-box" x="168" y="152" width="94" height="28" rx="14" /><T x={215} y={170} anchor="middle">REFUND</T>
    </Svg>
  );
}

function BrowserMandate() {
  return (
    <Svg>
      <rect className="pvx-box" x="28" y="24" width="264" height="172" rx="14" />
      <line className="pvx-dim" x1="28" y1="52" x2="292" y2="52" />
      {[44, 58, 72].map((x) => <circle key={x} className="pvx-dim" cx={x} cy="38" r="3.5" />)}
      <rect className="pvx-dim" x="100" y="30" width="160" height="16" rx="8" />
      <rect className="pvx-solid" x="48" y="72" width="224" height="44" rx="10" style={{ opacity: 0.2 }} />
      <rect className="pvx-acc" x="48" y="72" width="224" height="44" rx="10" />
      <T x={62} y={99}>MANDATE</T>
      <rect className="pvx-solid" x="48" y="140" width="100" height="32" rx="16" style={{ opacity: 0.85 }} />
      <text className="pvx-cmd" x="98" y="161" textAnchor="middle">APPROVE</text>
      <rect className="pvx-box" x="160" y="140" width="80" height="32" rx="16" /><T x={200} y={160} anchor="middle">DENY</T>
    </Svg>
  );
}

function Pipeline() {
  return (
    <Svg>
      <line className="pvx-dim" x1="50" y1="110" x2="270" y2="110" />
      <line className="pvx-acc pvx-travel-line" x1="50" y1="110" x2="270" y2="110" />
      {['SIGNAL', 'GATES', 'FILL', 'RECORD'].map((n, i) => (
        <g key={n}>
          <circle className={i === 2 ? 'pvx-solid' : 'pvx-box'} cx={50 + i * 73.3} cy="110" r="16" />
          <T x={50 + i * 73.3} y={114} anchor="middle">{String(i + 1)}</T>
          <T x={50 + i * 73.3} y={150} anchor="middle">{n}</T>
        </g>
      ))}
    </Svg>
  );
}

const MAP: Record<string, () => React.ReactNode> = {
  'order-ladder': OrderLadder, 'alert-pulse': AlertPulse, 'copy-mirror': CopyMirror,
  'launch-radar': LaunchRadar, 'perp-ladder': PerpLadder, 'odds-bar': OddsBar,
  'key-vault': KeyVault, 'chat-commands': ChatCommands, 'sdk-stack': SdkStack,
  'approval-timeline': ApprovalTimeline, 'org-tree': OrgTree, 'credit-meter': CreditMeter,
  'paper-ledger': PaperLedger, 'verdict-card': VerdictCard, 'browser-mandate': BrowserMandate,
  'pipeline-flow': Pipeline,
};

/** Draws the graphic for a `visual` key. Wrap in an aria-hidden, tone-dark box. */
export default function ProductVisual({ visual }: { visual: string }) {
  switch (visual) {
    case 'route-map': return <RouteMap />;
    case 'venue-rank': return <VenueRank venues={rankVenues} />;
    case 'tool-orbit': return <ToolOrbit count={stats.mcpToolCount}><span className="v3-kicker">MCP</span></ToolOrbit>;
    case 'policy-rings': return <BoundaryRings quiet labels={['Agent', 'Policy']} />;
    case 'terminal-capture':
      return <ProductFrame calm src="/proof/spot-desk.png" width={3160} height={940} alt="Suwappu Terminal spot trading view" title="ETH/USDC" />;
    default: {
      const V = MAP[visual];
      return V ? <V /> : <div className="pvx-neutral" />;
    }
  }
}
