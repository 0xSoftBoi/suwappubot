import LiveQuote from '@/components/LiveQuote';
import SummerNav from '@/components/SummerNav';
import './hero-a.css';

export const metadata = { title: 'Hero A - dark institutional' };

export default function HeroA() {
  return (
    <main className="ha">
      <div className="ha__navwrap"><SummerNav /></div>
      <section className="ha__hero">
        <div className="ha__copy">
          <h1>Best price.<br />42 chains.<br /><em>You sign.</em></h1>
          <p>
            Nine routing providers compete for every trade. Non-custodial from
            quote to settlement.
          </p>
          <div className="ha__cta">
            <a className="ha__btn" href="https://t.me/suwappu_bot">Start trading free</a>
            <a className="ha__btn ha__btn--ghost" href="https://terminal.suwappu.bot">Open Terminal</a>
          </div>
        </div>
        <div className="ha__panel"><LiveQuote variant="dark" /></div>
      </section>
    </main>
  );
}
