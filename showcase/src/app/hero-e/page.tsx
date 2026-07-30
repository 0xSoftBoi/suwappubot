import LiveQuote from '@/components/LiveQuote';
import SummerNav from '@/components/SummerNav';
import Reveal from '@/components/Reveal';
import RouteField from '@/components/RouteField';
import './hero-e.css';

export const metadata = { title: 'Hero E - field + grid + routes' };

/** Verified product facts. Numerals render tabular. */
const RAIL = [
  { v: '41', l: 'chains' },
  { v: '9', l: 'routing providers' },
  { v: '22', l: 'MCP tools' },
  { v: '<400', l: 'ms to quote', unit: 'ms' },
];

export default function HeroE() {
  return (
    <main className="hd he">
      <SummerNav />

      <section className="hd__hero">
        <div className="hd__glow" aria-hidden="true" />
        <div className="he__grid" aria-hidden="true" />
        <RouteField />

        <p className="hd__eyebrow">Cross-chain execution</p>

        <h1 className="hd__h1">
          The best price,
          <br />
          proven every trade.
        </h1>

        <p className="hd__lead">
          Nine routing providers compete for every order across 41 chains.
          You hold the keys the whole way.
        </p>

        <div className="hd__cta">
          <a className="hd__btn" href="https://t.me/suwappu_bot">Start trading free</a>
          <a className="hd__btn hd__btn--ghost" href="https://terminal.suwappu.bot">
            Open Terminal
          </a>
        </div>

        {/* The product, not a picture of the product. */}
        <Reveal className="hd__stage">
          <LiveQuote variant="dark" />
        </Reveal>

        <Reveal className="hd__rail" delay={120}>
          {RAIL.map((s) => (
            <div className="hd__stat" key={s.l}>
              <span className="hd__stat-v">{s.v}</span>
              <span className="hd__stat-l">{s.l}</span>
            </div>
          ))}
        </Reveal>
      </section>
    </main>
  );
}
