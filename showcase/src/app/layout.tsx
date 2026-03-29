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
  title: 'Suwappu — Swap anything. Everywhere.',
  description:
    'One SDK. Fifteen chains. Install @suwappu/sdk and swap tokens across every major chain in three lines of code.',
  keywords: [
    'cross-chain swap',
    'DEX SDK',
    'Telegram bot',
    'agent tooling',
    'DeFi',
    'non-custodial',
    'MCP',
  ],
  openGraph: {
    title: 'Suwappu — Swap anything. Everywhere.',
    description:
      'One SDK. Fifteen chains. Three lines of code. Start swapping.',
    type: 'website',
    siteName: 'Suwappu',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Suwappu — Swap anything. Everywhere.',
    description:
      'One SDK. Fifteen chains. Three lines of code. Start swapping.',
  },
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
      </head>
      <body className="font-sans antialiased bg-[#faf8f4] text-[#1a1a1a]">{children}</body>
    </html>
  );
}
