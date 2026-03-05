import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Suwappu — Swap tokens from chat',
  description:
    'Type /s 100 USDC ETH in Telegram and get the best rate across 7 chains. Non-custodial, no app needed.',
  keywords: [
    'cross-chain swap',
    'Telegram bot',
    'DEX aggregator',
    'crypto',
    'DeFi',
    'non-custodial',
  ],
  openGraph: {
    title: 'Suwappu — Swap tokens from chat',
    description:
      'Type /s 100 USDC ETH in Telegram and get the best rate across 7 chains.',
    type: 'website',
    siteName: 'Suwappu',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Suwappu — Swap tokens from chat',
    description:
      'Type /s 100 USDC ETH in Telegram and get the best rate across 7 chains.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="font-body antialiased">{children}</body>
    </html>
  );
}
