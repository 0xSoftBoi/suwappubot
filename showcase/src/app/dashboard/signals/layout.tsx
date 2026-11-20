import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The page is a client component and cannot export metadata, so the tab
// showed the site-wide default title.
export const metadata: Metadata = {
  title: 'Signal Intelligence',
  description: 'Explainable on-chain signals with the evidence behind each score.',
};

export default function SignalsLayout({ children }: { children: ReactNode }) {
  return children;
}
