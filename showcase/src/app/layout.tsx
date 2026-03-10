import type { Metadata } from 'next';
import { Syne, Outfit, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
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
  title: 'Suwappu — Cross-chain DEX infrastructure',
  description:
    'SDK, REST API, and Telegram bot for swapping tokens across 15 chains. bun add @suwappu/sdk',
  keywords: [
    'cross-chain swap',
    'DEX SDK',
    'Telegram bot',
    'agent tooling',
    'bun',
    'DeFi',
    'non-custodial',
    'MCP',
    'OpenClaw',
  ],
  openGraph: {
    title: 'Suwappu — Cross-chain DEX infrastructure',
    description:
      'Six tools. Fifteen chains. bun add @suwappu/sdk and start building.',
    type: 'website',
    siteName: 'Suwappu',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Suwappu — Cross-chain DEX infrastructure',
    description:
      'Six tools. Fifteen chains. bun add @suwappu/sdk and start building.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${syne.variable} ${outfit.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="author" type="text/plain" href="/llms.txt" />
      </head>
      <body className="font-sans antialiased bg-[#07070e] text-[#e8e6e3]">{children}</body>
    </html>
  );
}
