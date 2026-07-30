import LiveQuote from '@/components/LiveQuote';
import SummerNav from '@/components/SummerNav';
import './hero-b.css';

export const metadata = { title: 'Hero B - warm brand' };

export default function HeroB() {
  return (
    <main className="hb">
      <SummerNav />
      <section className="hb__hero">
        <div className="hb__copy">
          <p className="hb__kicker">Now in open beta</p>
          <h1>Trade anything.<br /><span>No limits.</span></h1>
          <p className="hb__lead">
            Suwappu routes every trade across 41 chains to find the best price.
            Non-custodial, no KYC.
          </p>
          <div className="hb__cta">
            <a className="hb__btn" href="https://t.me/suwappu_bot">Start trading free</a>
            <a className="hb__btn hb__btn--ghost" href="https://terminal.suwappu.bot">Open Terminal</a>
          </div>
        </div>
        <div className="hb__panel"><LiveQuote variant="warm" /></div>
      </section>
    </main>
  );
}
