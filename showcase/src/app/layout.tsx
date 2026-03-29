import type { Metadata } from 'next';
import { Space_Grotesk, DM_Sans, Fira_Code } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const firaCode = Fira_Code({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://suwappu.bot'),
  title: {
    default: 'Suwappu — Cross-chain DeFi SDK for AI Agents',
    template: '%s | Suwappu',
  },
  description:
    'One SDK. Fifteen chains. Swap tokens, trade perpetual futures, access prediction markets, and lend — all from a single API. Built for AI agents, bots, and developers.',
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
    title: 'Suwappu — Cross-chain DeFi SDK for AI Agents',
    description:
      'Swap tokens across 15 chains, trade perps, access prediction markets, and lend — one SDK, three lines of code.',
    type: 'website',
    siteName: 'Suwappu',
    url: 'https://suwappu.bot',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@suwappubot',
    creator: '@suwappubot',
    title: 'Suwappu — Cross-chain DeFi SDK for AI Agents',
    description:
      'Swap tokens across 15 chains, trade perps, access prediction markets — one SDK, three lines of code.',
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${dmSans.variable} ${firaCode.variable}`}>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="author" type="text/plain" href="/llms.txt" />
        <link rel="canonical" href="https://suwappu.bot" />
      </head>
      <body className="font-sans antialiased bg-[#faf8f4] text-[#1a1a1a]">{children}</body>
    </html>
  );
}
