import type { Metadata } from 'next';
import stats from '@/data/stats.generated.json';
import DocsOverview from './DocsOverview';

export const metadata: Metadata = {
  title: 'Documentation — Suwappu',
  description: `API reference, guides, and protocol specs for building with Suwappu. Cross-chain swaps, perps, and gasless trades across ${stats.platformChains} chains.`,
};

export default function DocsPage() {
  return <DocsOverview />;
}
