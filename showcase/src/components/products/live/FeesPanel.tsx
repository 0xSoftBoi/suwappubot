'use client';

import FeeCalculator from '@/components/FeeCalculator';

/** Tier fees exactly as stated on the trader product pages (Free 1.0%, Pro 0.5% at $9.99, Premium 0.3% at $29.99, Enterprise 0.1% quoted). */
const TIERS = [
  { name: 'Free', monthly: 0, feePct: 1.0 },
  { name: 'Pro', monthly: 9.99, feePct: 0.5 },
  { name: 'Premium', monthly: 29.99, feePct: 0.3 },
  { name: 'Enterprise', monthly: null, feePct: 0.1 },
];
export default function FeesPanel() {
  return <section className="lv"><FeeCalculator tiers={TIERS} /></section>;
}
