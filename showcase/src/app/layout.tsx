import type { Metadata, Viewport } from 'next';
import StructuredData from '../components/StructuredData';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
};

export const metadata: Metadata = {
  title: 'Suwappu — Swap tokens across 15+ chains from chat',
  description:
    'Cross-chain DEX bot for Telegram, WhatsApp, and Discord. Swap tokens across 15+ chains with the best rates. Non-custodial, no app needed — just type /s 100 USDC ETH.',
  keywords: [
    'cross-chain swap',
    'Telegram bot',
    'DEX aggregator',
    'crypto',
    'DeFi',
    'non-custodial',
    'multi-chain',
    'token swap',
    'WhatsApp crypto',
    'Discord bot',
    'Suwappu',
  ],
  metadataBase: new URL('https://suwappu.bot'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Suwappu — Swap tokens across 15+ chains from chat',
    description:
      'Cross-chain DEX bot for Telegram, WhatsApp, and Discord. Swap tokens across 15+ chains with the best rates. Non-custodial, no app needed.',
    type: 'website',
    url: 'https://suwappu.bot',
    siteName: 'Suwappu',
    locale: 'en_US',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Suwappu — Cross-chain DEX bot',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Suwappu — Swap tokens across 15+ chains from chat',
    description:
      'Cross-chain DEX bot for Telegram, WhatsApp, and Discord. Non-custodial, no app needed.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: '/favicon.ico',
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <StructuredData />
      </head>
      <body className="font-body antialiased bg-suwappu-dark-bg text-suwappu-dark-text">{children}</body>
    </html>
  );
}
