export default function StructuredData() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Suwappu',
    description:
      'Cross-chain DEX bot — swap tokens across 15+ chains from Telegram, WhatsApp, and Discord. Non-custodial, no app needed.',
    url: 'https://suwappu.bot',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'iOS, Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    aggregateRating: undefined,
    keywords:
      'cross-chain swap, DEX aggregator, Telegram bot, DeFi, cryptocurrency, non-custodial',
    availableOnDevice: ['Telegram', 'WhatsApp', 'Discord', 'iOS'],
  };

  // Remove undefined values
  const cleaned = JSON.parse(JSON.stringify(jsonLd));

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(cleaned) }}
    />
  );
}
