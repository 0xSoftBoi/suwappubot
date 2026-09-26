import type { Metadata } from 'next';
import PassportPageClient from './PassportPageClient';

export const metadata: Metadata = {
  title: 'Agent Swap Passport | Suwappu',
  description:
    'ETHGlobal Tokyo 2026 live demo: one agent identity across World ID proof-of-personhood, an ' +
    'ENSv2 Sepolia subname, and a World-ID-gated Uniswap v4 swap hook.',
  alternates: { canonical: '/passport' },
  openGraph: {
    title: 'Agent Swap Passport',
    description:
      'World ID + ENSv2 + Uniswap v4: one gated identity for AI agent swaps, live at ETHGlobal Tokyo 2026.',
    url: '/passport',
  },
};

export default function PassportPage() {
  return <PassportPageClient />;
}
