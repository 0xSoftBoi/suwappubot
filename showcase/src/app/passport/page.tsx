import type { Metadata } from 'next';
import PassportPageClient from './PassportPageClient';

export const metadata: Metadata = {
  title: 'Agent Passport | Suwappu',
  description:
    'Give your AI agent an identity people can trust. A human proves they’re real, and every ' +
    'trade the agent makes after that is protected — powered by World, ENS, and Uniswap.',
  alternates: { canonical: '/passport' },
  openGraph: {
    title: 'Agent Passport',
    description: 'Give your AI agent an identity people can trust.',
    url: '/passport',
  },
};

export default function PassportPage() {
  return <PassportPageClient />;
}
