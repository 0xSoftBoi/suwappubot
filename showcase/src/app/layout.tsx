import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="author" type="text/plain" href="/llms.txt" />
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
