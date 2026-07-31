import type { Metadata } from 'next';
import stats from '@/data/stats.generated.json';
import { Geist, JetBrains_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import Analytics from '@/components/Analytics';
import AttributionCapture from '@/components/AttributionCapture';
import './summer-token-vars.css';
import './globals.css';

// Two families, one voice: Geist carries display + UI + body, JetBrains Mono
// is rationed to numerals, kickers, and code. Geist is loaded ONCE: globals.css
// aliases --font-display to --font-sans so both var() names resolve to the same
// instance (no second font download).
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://suwappu.bot'),
  title: {
    default: 'Suwappu: Cross-chain DeFi SDK for AI Agents',
    template: '%s | Suwappu',
  },
  description:
    `One SDK. ${stats.platformChains} chains. Swap tokens, trade HyperLiquid perps, make gasless trades, access prediction markets, and lend: all from a single API. Built for AI agents, bots, and developers.`,
  keywords: [
    'cross-chain swap',
    'DEX SDK',
    'DEX aggregator',
    'Telegram trading bot',
    'AI agent tooling',
    'DeFi SDK',
    'MCP server',
    'agent-to-agent protocol',
    'non-custodial swap',
    'perpetual futures API',
    'prediction markets API',
    'DeFi lending API',
    'token swap API',
    'multi-chain',
    'Ethereum',
    'Base',
    'Solana',
    'Arbitrum',
    'cross-chain bridge',
    'MEV protection',
    'Suwappu',
  ],
  authors: [{ name: 'Suwappu', url: 'https://suwappu.bot' }],
  creator: 'Suwappu',
  publisher: 'Suwappu',
  openGraph: {
    title: 'Suwappu | Cross-chain DeFi SDK for AI Agents',
    description:
      `Swap tokens across ${stats.platformChains} chains, trade HyperLiquid perps, make gasless trades, access prediction markets, and lend: one SDK, three lines of code.`,
    type: 'website',
    siteName: 'Suwappu',
    url: 'https://suwappu.bot',
    locale: 'en_US',
    // og:image is auto-wired by Next from opengraph-image.tsx (file convention).
  },
  twitter: {
    card: 'summary_large_image',
    site: '@suwappubot',
    creator: '@suwappubot',
    title: 'Suwappu | Cross-chain DeFi SDK for AI Agents',
    description:
      `Swap tokens across ${stats.platformChains} chains, trade HyperLiquid perps, make gasless trades: one SDK, three lines of code.`,
    // twitter:image is auto-wired by Next from twitter-image.tsx (file convention).
  },
  alternates: {
    canonical: 'https://suwappu.bot',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  category: 'technology',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${geist.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="author" type="text/plain" href="/llms.txt" />
        <link rel="canonical" href="https://suwappu.bot" />
      </head>
      <body className="font-sans antialiased bg-[var(--suwappu-summer-canvas-warm)] text-[var(--suwappu-summer-ink)]">
        <a href="#main-content" className="skip-to-content">Skip to content</a>
        <Analytics />
        <AttributionCapture />
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
