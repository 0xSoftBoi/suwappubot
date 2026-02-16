import type { Metadata } from 'next'
import './globals.css'
import '@turnkey/react-wallet-kit/styles.css'
import { TurnkeyProvider } from '@/components/providers/TurnkeyProvider'

export const metadata: Metadata = {
  title: 'Suwappu - Cross-Chain DEX Bot | Trade Anywhere',
  description: 'Swap tokens across 7+ blockchains from Telegram, WhatsApp, or our Mobile App. Fast, secure, and kawaii cross-chain trading.',
  keywords: ['DEX', 'cross-chain', 'swap', 'Telegram bot', 'WhatsApp', 'crypto trading', 'DeFi'],
  authors: [{ name: 'Suwappu Team' }],
  openGraph: {
    title: 'Suwappu - Cross-Chain DEX Bot',
    description: 'Trade tokens across 7+ chains from your favorite messaging apps',
    type: 'website',
    siteName: 'Suwappu',
    images: [
      {
        url: '/images/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Suwappu - Cross-Chain Trading Made Kawaii',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Suwappu - Cross-Chain DEX Bot',
    description: 'Trade tokens across 7+ chains from Telegram, WhatsApp, or Mobile',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">
        <TurnkeyProvider>
          {children}
        </TurnkeyProvider>
      </body>
    </html>
  )
}
