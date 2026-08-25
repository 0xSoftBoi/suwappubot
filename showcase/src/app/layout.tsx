import type { Metadata } from 'next';
import stats from '@/data/stats.generated.json';
import { Geist, Newsreader, JetBrains_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import Analytics from '@/components/Analytics';
import AttributionCapture from '@/components/AttributionCapture';
import './summer-token-vars.css';
import './globals.css';
import './institutional.css';

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

// Display-only serif: hero + section headlines and the A2A pull-quote on the
// homepage. Never used for body copy or UI — Geist and JetBrains Mono keep
// carrying those. Newsreader replaced EB Garamond in round 2 of the display
// A/B (see docs/design/serif-decision.md): rendered over the dark ocean hero
// at real sizes it carries the sharp, high-contrast financial-masthead
// register the brand wants, where Garamond read bookish and light. Variable
// weight + true italics + an optical-size axis (opsz), so display sizes get
// the tighter high-contrast display cut automatically.
const displaySerif = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://suwappu.bot'),
  title: {
    default: 'Suwappu: Cross-chain DeFi SDK for AI Agents',
    template: '%s | Suwappu',
  },
  description:
    `One API across ${stats.platformChains} chains: swap tokens, research HyperLiquid perps and Morpho markets, access prediction markets, and build agent automations. Built for AI agents, bots, and developers.`,
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
      `Swap tokens across ${stats.platformChains} chains, research HyperLiquid perps and Morpho markets, and access prediction markets through one agent API.`,
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
      `Swap tokens across ${stats.platformChains} chains and build agent workflows with REST, SDK, MCP, and A2A.`,
    // twitter:image is auto-wired by Next from twitter-image.tsx (file convention).
  },
  // Deliberately no canonical at the root. Next inherits metadata down the tree
  // rather than deriving a per-route URL, so a value here is emitted verbatim on
  // every page and declares the whole site a duplicate of one URL. Routes that
  // need a canonical set it themselves (see app/research/[slug]); the rest
  // self-canonicalize, which is the correct default.
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
    <html lang={locale} className={`${geist.variable} ${jetbrainsMono.variable} ${displaySerif.variable}`}>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="author" type="text/plain" href="/llms.txt" />
        {/* No hardcoded canonical here: this <head> renders on every route, so a
            literal homepage URL declared every page a duplicate of "/". The
            canonical comes from metadata.alternates.canonical instead, which
            defaults to "/" for the root and is overridden per route. */}
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
