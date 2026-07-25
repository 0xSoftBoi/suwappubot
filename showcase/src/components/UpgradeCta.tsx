'use client';

/**
 * Pro/Premium "Upgrade" CTA on the pricing page — sends the visitor into a
 * Stripe checkout session on api-ts (no Telegram/webapp account required;
 * see api-ts src/routes/billing.ts GET /billing/stripe/checkout-web).
 * Fires `upgrade_click` with the tier so we can see web-checkout intent by
 * plan.
 *
 * Uses a client-side fetch(...&format=json) + window.location.assign on
 * click rather than a plain <a href> to the endpoint, because the endpoint
 * has a real side effect (creates a Stripe checkout session + a
 * web_checkouts row) — a plain GET href is prefetchable by the browser/link
 * crawlers and would create throwaway sessions. The href itself is a
 * rel="nofollow" fallback pointing at /pricing (not the endpoint), so a
 * prefetch or JS-disabled click never touches the checkout endpoint.
 */
import { useState } from 'react';
import { upgradeCheckoutUrl } from '@/lib/links';
import { track } from '@/lib/analytics';

interface UpgradeCtaProps {
  tier: 'pro' | 'premium';
  className: string;
  children: React.ReactNode;
}

export default function UpgradeCta({ tier, className, children }: UpgradeCtaProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
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
      // fall through to Telegram-safe fallback below
    }
    setLoading(false);
    window.location.assign('/pricing');
  }

  return (
    <a
      className={className}
      href="/pricing"
      rel="nofollow"
      aria-busy={loading}
      onClick={handleClick}
    >
      {loading ? 'Redirecting…' : children}
    </a>
  );
}
