'use client';

import FeeCalculator from '@/components/FeeCalculator';
import { LADDER } from '@/data/pricingTiers';

/** Same ladder as the pricing page (src/data/pricingTiers.ts). */
export default function FeesPanel() {
  return <section className="lv"><FeeCalculator tiers={LADDER.map((t) => ({ ...t }))} /></section>;
}
