import type { Metadata } from 'next';
import { Inter, DM_Serif_Display, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-serif',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
    <html lang="en" className={`${inter.variable} ${dmSerifDisplay.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="author" type="text/plain" href="/llms.txt" />
      </head>
      <body className="font-sans antialiased bg-zinc-950 text-zinc-50">{children}</body>
    </html>
  );
}
