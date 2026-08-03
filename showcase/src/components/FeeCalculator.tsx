'use client';

/**
 * FeeCalculator: the honest answer to "is a subscription worth it for me?"
 *
 * A subscription page that leads with $9.99/mo is answering the wrong question.
 * On a trading product the subscription is rounding error; the swap fee is the
 * real cost. A trader moving $50k/month pays $500 in fees on Free and $150 on
 * Premium: the $29.99 is noise next to a $320 swing. Nothing on this page let
 * anyone see that, so the tiers read as arbitrary.
 *
 * This computes true monthly cost (subscription + fee x volume) for every tier
 * and names the cheapest. It will tell a low-volume trader to stay on Free, and
 * that is the point: a calculator that always upsells is an ad, and readers can
 * tell. Being right in public is what makes the recommendation worth trusting.
 *
 * Tiers are passed in from the page so the fee ladder has exactly one source.
 */

import { useState, useId } from 'react';
import styles from './FeeCalculator.module.css';

export type CalcTier = {
  name: string;
  /** Subscription cost per month in USD. Null for "contact us" pricing. */
  monthly: number | null;
  /** Swap fee as a percentage, e.g. 0.5 for 0.5%. */
  feePct: number;
};

const PRESETS = [1_000, 10_000, 50_000, 250_000];

const usd = (n: number) =>
  n >= 1000
    ? `$${Math.round(n).toLocaleString('en-US')}`
    : `$${n.toFixed(n < 100 ? 2 : 0)}`;

export default function FeeCalculator({ tiers }: { tiers: CalcTier[] }) {
  const [volume, setVolume] = useState(10_000);
  const inputId = useId();

  const quotable = tiers.filter((t) => t.monthly !== null);
  // Compare in whole cents. At the exact break-even ($10k volume) Pro and Premium
  // both cost $59.99, but in binary 29.99 + 30 lands at 59.989999…, so a raw float
  // compare crowns Premium while the page shows two identical numbers. Rounding to
  // cents first makes the tie a real tie.
  const rows = quotable.map((t) => {
    const cents = Math.round(((t.monthly as number) + (volume * t.feePct) / 100) * 100);
    return { ...t, cents, total: cents / 100 };
  });
  // On a genuine tie, prefer the cheaper subscription: same cost, less commitment.
  const cheapest = rows.reduce(
    (a, b) =>
      b.cents < a.cents || (b.cents === a.cents && (b.monthly as number) < (a.monthly as number))
        ? b
        : a,
    rows[0]
  );
  const baseline = rows[0]; // Free: what they pay today if they do nothing
  const saving = (baseline.cents - cheapest.cents) / 100;
  // Anything else costing the same is shown as an equal, not a runner-up.
  const tied = rows.filter((r) => r.cents === cheapest.cents && r.name !== cheapest.name);
  // Quote-only tiers (Enterprise) are excluded from the ranking above: we can't
  // total a price we don't publish, but their fee is real and comparable.
  const enterprise = tiers.find((t) => t.monthly === null);
  const enterpriseGap = enterprise
    ? cheapest.total - (enterprise.monthly ?? 0) - (volume * enterprise.feePct) / 100
    : 0;

  return (
    <section className={styles.calc} aria-labelledby={`${inputId}-heading`}>
      <div className={styles.head}>
        <p className="summer-kicker">What you&rsquo;d actually pay</p>
        <h2 className="mkt-h2" id={`${inputId}-heading`}>
          The subscription isn&rsquo;t the price. The fee is.
        </h2>
        <p className={styles.lead}>
          Every tier lowers your swap fee. Put in what you trade in a month and see the
          real cost: subscription plus fees, side by side.
        </p>
      </div>

      <div className={styles.controls}>
        <label className={styles.label} htmlFor={inputId}>
          Monthly trading volume
        </label>
        <div className={styles.inputRow}>
          <span className={styles.currency} aria-hidden="true">
            $
          </span>
          <input
            id={inputId}
            className={styles.input}
            type="number"
            min={0}
            step={1000}
            value={volume}
            onChange={(e) => setVolume(Math.max(0, Number(e.target.value) || 0))}
            inputMode="numeric"
          />
        </div>
        <div className={styles.presets} role="group" aria-label="Common volumes">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={styles.preset}
              aria-pressed={volume === p}
              onClick={() => setVolume(p)}
            >
              {usd(p)}
            </button>
          ))}
        </div>
      </div>

      <ol className={styles.rows}>
        {rows.map((r) => {
          const best = r.cents === cheapest.cents;
          // Bar is relative to the most expensive option so the shape carries meaning.
          const max = Math.max(...rows.map((x) => x.total)) || 1;
          return (
            <li key={r.name} className={best ? `${styles.row} ${styles.rowBest}` : styles.row}>
              <span className={styles.tier}>
                {r.name}
                {best && (
                  <span className={styles.bestTag}>
                    {tied.length ? 'cheapest: tied' : 'cheapest for you'}
                  </span>
                )}
              </span>
              <span className={styles.bar} aria-hidden="true">
                <span className={styles.barFill} style={{ width: `${(r.total / max) * 100}%` }} />
              </span>
              <span className={styles.total}>
                {usd(r.total)}
                <span className={styles.per}>/mo</span>
              </span>
            </li>
          );
        })}
      </ol>

      <p className={styles.verdict} role="status">
        {saving > 0.005 ? (
          <>
            At {usd(volume)} a month,{' '}
            <strong>
              {cheapest.name}
              {tied.length ? ` and ${tied.map((t) => t.name).join(' and ')}` : ''}
            </strong>{' '}
            {tied.length ? 'both cost ' : 'costs '}
            <strong>{usd(saving)} less</strong> than staying on {baseline.name}
            {tied.length ? `: pick ${cheapest.name} for the lower commitment` : ''}.
          </>
        ) : (
          <>
            At {usd(volume)} a month, <strong>{baseline.name}</strong> is already your cheapest
            option. Upgrading would cost you more: come back when you&rsquo;re trading more.
          </>
        )}
      </p>

      {/* Enterprise has no published subscription, so it can't sit in the ranked list
          without inventing a number. But staying silent fails the exact reader worth
          converting: at high volume its fee alone beats the best quotable tier by a
          wide margin. Show the fee-only comparison, name what's unknown, and let them
          judge. */}
      {enterprise && enterpriseGap > 100 && (
        <p className={styles.enterprise}>
          Trading this much? <strong>Enterprise</strong> is {enterprise.feePct}%: about{' '}
          <strong>{usd((volume * enterprise.feePct) / 100)}</strong> in fees, {usd(enterpriseGap)}{' '}
          below {cheapest.name} before its subscription, which is priced per desk.{' '}
          <a href="/contact">Get a quote</a>.
        </p>
      )}

      <p className={styles.footnote}>
        Fees only. Network gas and third-party liquidity costs are separate, and Enterprise is
        priced per desk: <a href="/contact">talk to us</a> for that.
      </p>
    </section>
  );
}
