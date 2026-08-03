import LiveQuote from '@/components/LiveQuote';
import SummerNav from '@/components/SummerNav';
import './hero-c.css';

export const metadata = { title: 'Hero C - the number is the hero' };

export default function HeroC() {
  return (
    <main className="hc">
      <div className="hc__navwrap"><SummerNav /></div>
      <section className="hc__hero">
        <p className="hc__eyebrow">Right now, on Base</p>
        <div className="hc__stage"><LiveQuote variant="dark" /></div>
        <h1 className="hc__h1">
          Every route, raced. <span>You keep the difference.</span>
        </h1>
        <div className="hc__cta">
          <a className="hc__btn" href="https://t.me/suwappu_bot">Start trading free</a>
          <a className="hc__btn hc__btn--ghost" href="https://terminal.suwappu.bot">Open Terminal</a>
        </div>
      </section>
    </main>
  );
}
