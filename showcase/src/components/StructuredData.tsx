export default function StructuredData() {
  const schemas = [
    // Main application
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Suwappu',
      description:
        'Cross-chain DeFi SDK for AI agents — swap tokens, trade perpetual futures, access prediction markets, and lend across 15+ blockchains.',
      url: 'https://suwappu.bot',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web, iOS',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      keywords:
        'cross-chain swap, DEX aggregator, DeFi SDK, AI agent tooling, MCP server, perpetual futures, prediction markets, lending',
      featureList: [
        'Cross-chain token swaps across 15+ blockchains',
        'Perpetual futures trading via HyperLiquid',
        'Prediction markets via Polymarket',
        'DeFi lending via Morpho',
        'MCP server for Claude and AI agents',
        'A2A agent-to-agent protocol',
        'REST API with OpenAPI spec',
        'Telegram trading bot',
        'MEV-shielded routing',
        'Non-custodial execution',
      ],
    },
    // Organization
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Suwappu',
      url: 'https://suwappu.bot',
      sameAs: [
        'https://x.com/suwappubot',
        'https://t.me/suwappu_bot',
        'https://github.com/0xSoftBoi/suwappubot',
      ],
    },
    // API documentation
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      name: 'Suwappu API Documentation',
      description:
        'Complete API reference for the Suwappu cross-chain DeFi SDK. Endpoints for swaps, perpetual futures, prediction markets, lending, and wallet management.',
      url: 'https://suwappu.bot/docs',
      about: {
        '@type': 'SoftwareApplication',
        name: 'Suwappu API',
      },
    },
    // FAQ
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What chains does Suwappu support?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Suwappu supports 15+ chains including Ethereum, Base, Arbitrum, Optimism, Solana, Polygon, BSC, Avalanche, Fantom, Linea, Mantle, Gnosis, Scroll, Sui, TON, and Tempo.',
          },
        },
        {
          '@type': 'Question',
          name: 'How do I integrate Suwappu with Claude or other AI agents?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Suwappu provides an MCP server with 11 tools. Add the MCP server URL to your Claude Desktop config or use the npm package @suwappu/mcp-server for local stdio transport.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is Suwappu non-custodial?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Your keys never leave your agent. Suwappu routes the trade, your agent signs and submits. We never touch your funds.',
          },
        },
        {
          '@type': 'Question',
          name: 'What can I trade on Suwappu besides token swaps?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Beyond cross-chain swaps, Suwappu supports perpetual futures (via HyperLiquid), prediction markets (via Polymarket), DeFi lending (via Morpho), limit orders, and DCA strategies.',
          },
        },
      ],
    },
  ];

  return (
    <>
      {schemas.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}
