'use client';

/**
 * Pro/Premium "Upgrade" CTA on the pricing page: sends the visitor into a
 * Stripe checkout session on api-ts (no Telegram/webapp account required;
 * see api-ts src/routes/billing.ts GET /billing/stripe/checkout-web).
 * Fires `upgrade_click` with the tier so we can see web-checkout intent by
 * plan.
 *
 * Uses a client-side fetch(...&format=json) + window.location.assign on
 * click rather than a plain <a href> to the endpoint, because the endpoint
 * has a real side effect (creates a Stripe checkout session + a
 * web_checkouts row): a plain GET href is prefetchable by the browser/link
 * crawlers and would create throwaway sessions. The href itself is a
 * rel="nofollow" fallback pointing at /pricing (not the endpoint), so a
 * prefetch or JS-disabled click never touches the checkout endpoint.
 *
 * Failure is surfaced, never swallowed. The previous fallback re-navigated to
 * /pricing, which reads to the buyer as "the button is broken": same page,
 * no explanation, no next step. Now the component holds its place, says what
 * happened, and offers a retry plus a human.
 */
import { useState } from 'react';
import { upgradeCheckoutUrl, ENTERPRISE_CONTACT_PATH } from '@/lib/links';
import { track } from '@/lib/analytics';
import styles from './UpgradeCta.module.css';

interface UpgradeCtaProps {
  tier: 'pro' | 'premium';
  className: string;
  children: React.ReactNode;
}

export default function UpgradeCta({ tier, className, children }: UpgradeCtaProps) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setFailed(false);
    track('upgrade_click', { tier });

    try {
      const res = await fetch(`${upgradeCheckoutUrl(tier)}&format=json`, {
        headers: { Accept: 'application/json' },
      });
      const json: { url?: string; error?: string } = await res.json();
      if (json.url) {
        window.location.assign(json.url);
        return;
      }
    } catch {
      // fall through to the visible error state below
    }
    setLoading(false);
    setFailed(true);
  }

  return (
    <>
      <a
        className={className}
        href="/pricing"
        rel="nofollow"
        aria-busy={loading}
        onClick={handleClick}
      >
        <span className={styles.label}>
          {loading && <span className={styles.spinner} aria-hidden="true" />}
          {loading ? 'Opening checkout…' : failed ? 'Try again' : children}
        </span>
      </a>
      {failed && (
        <span className={styles.error} role="alert">
          Checkout unavailable: try again, or{' '}
          <a href={ENTERPRISE_CONTACT_PATH}>contact us</a> and we&rsquo;ll set it up for you.
        </span>
      )}
    </>
  );
}
