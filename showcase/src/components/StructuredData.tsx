import stats from '@/data/stats.generated.json';
export default function StructuredData() {
  const schemas = [
    // Main application
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Suwappu',
      description:
        `Execution infrastructure between trade intent and supported markets, with ${stats.platformChains} platform chains and route-specific interface coverage.`,
      url: 'https://suwappu.bot',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web, iOS',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      keywords:
        'cross-chain swap, DEX aggregator, DeFi SDK, AI agent tooling, MCP server, perpetual futures, prediction markets, lending',
      featureList: [
        `Cross-chain token swaps across ${stats.platformChains} blockchains`,
        'HyperLiquid market, quote, and position research via the Agent API',
        'Tempo token discovery with execution availability varying by interface',
        'Prediction markets via Polymarket',
        'Morpho lending-market research',
        'MCP server for Claude and AI agents',
        'A2A agent-to-agent protocol',
        'REST API with OpenAPI spec',
        'Telegram trading bot',
        'MEV-shielded routing',
        'User-signed execution with TEE-backed and self-custody key options',
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
        'Complete API reference for Suwappu: swap execution, HyperLiquid market research, prediction markets, Morpho market data, and managed-wallet controls.',
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
            text: `Suwappu supports ${stats.platformChains} platform chains, including Ethereum, Base, Arbitrum, Optimism, Solana, Polygon, BSC, Avalanche, Starknet, TRON, Tempo, and Bitcoin L2s, with ${stats.routerCount} integrated routing venues. Venue availability varies by route.`,
          },
        },
        {
          '@type': 'Question',
          name: 'How do I integrate Suwappu with Claude or other AI agents?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Suwappu runs a remote MCP server at https://api.suwappu.bot/mcp exposing 22 tools over Streamable HTTP. There is nothing to install locally: in Claude Code run "claude mcp add --transport http suwappu https://api.suwappu.bot/mcp", in Codex add it to ~/.codex/config.toml, or point any MCP client at the URL with an Authorization: Bearer header.',
          },
        },
        {
          '@type': 'Question',
          name: 'Who holds the keys on Suwappu?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'By default you sign every swap yourself. Managed-wallet keys are secured by envelope encryption (kms_aesgcm_v2) or signed inside a hardware-backed TEE via Turnkey, never as a plaintext key Suwappu can read. Bring your own keys via the agent API for full self-custody.',
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
