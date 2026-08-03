import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';

export const metadata: Metadata = {
  title: 'Risk Disclosure | Suwappu',
  description:
    'A plain-language disclosure of the risks involved in using Suwappu to trade and swap digital assets across chains.',
};

export default function RiskDisclosurePage() {
  return (
    <main id="main-content" className="summer-page docs-shell sw-dark">
      <Navigation />
      <div className="summer-shell mkt-page">
        <nav className="doc-breadcrumb">
          <a href="/">Home</a>
          <span className="doc-breadcrumb__sep">/</span>
          <span>Legal</span>
          <span className="doc-breadcrumb__sep">/</span>
          <span>Risk Disclosure</span>
        </nav>
        <article className="legal-page sw-measure">
        <div className="legal-page__card">
          <p className="summer-kicker">Legal</p>
          <h1>Risk Disclosure</h1>
          <p className="legal-page__updated">Last updated: June 18, 2026</p>

          <p>This page explains, in plain terms, the material risks of using Suwappu: the Telegram bot, trading terminal, REST API, SDK, and MCP server (together, the “Service”): to swap, hold, or trade digital assets. Read it alongside our <a href="/legal/terms">Terms of Service</a>. It does not cover every risk and is not a substitute for your own research or professional advice.</p>

          <h2>1. Volatility</h2>
          <p>Digital asset prices can move sharply and unpredictably, in either direction, within minutes. Quotes, routes, and estimated outputs shown before a swap can become stale by the time a transaction confirms. You can lose a substantial portion, or all: of the value you put in.</p>

          <h2>2. Smart contract risk</h2>
          <p>Swaps, routing, and liquidity provisioning rely on smart contracts written and audited by us and by third parties. Contracts can contain bugs, be exploited, or behave unexpectedly under conditions that were not anticipated. No audit or amount of testing eliminates this risk. A contract failure can result in funds being lost, locked, or stolen.</p>

          <h2>3. Bridge &amp; cross-chain risk</h2>
          <p>Cross-chain swaps route through bridges and messaging protocols operated by third parties. Bridges are a common target for exploits and have historically suffered some of the largest losses in the industry. A bridge outage, exploit, or validator failure can delay, fail, or permanently lose a cross-chain transfer that is in transit, outside our control.</p>

          <h2>4. Custody &amp; key loss</h2>
          <p>If you self-custody (bring your own keys), you retain sole control of your funds, and sole responsibility for keeping your keys, seed phrase, and devices safe. Lost keys mean permanently lost funds; there is no recovery mechanism. If you use a managed wallet, keys are encrypted at rest and access is gated by your account credentials and any 2FA/limits you configure: protect those credentials with the same care you would a seed phrase.</p>

          <h2>5. Slippage &amp; MEV</h2>
          <p>Between the moment you submit a swap and the moment it confirms on-chain, the price can move, liquidity can shift, or other transactions (including MEV: sandwich attacks, front-running, and similar extractive strategies) can affect your execution price. Setting tight slippage tolerance reduces but does not eliminate this exposure, and can cause transactions to fail instead.</p>

          <h2>6. No investment advice</h2>
          <p>Nothing on this site, in the bot, in the terminal, or returned by the API or MCP server is a recommendation to buy, sell, hold, or take any position in any asset. Quotes, routes, market data, and any AI- or agent-generated output are informational only. You are solely responsible for evaluating and making your own trading decisions, and should consult independent financial, legal, or tax advice before trading.</p>

          <h2>7. Regulatory &amp; jurisdictional risk</h2>
          <p>The legal status of digital assets, derivatives, and related services varies by country and changes over time. Some products or features described on this site may not be available, or may be restricted, in your jurisdiction. You are responsible for determining whether your use of the Service is lawful where you are located, including any tax obligations that result from your activity.</p>

          <h2>8. Third-party liquidity &amp; venues</h2>
          <p>Suwappu routes across multiple third-party aggregators, liquidity pools, and trading venues to find the best available price. We do not control the solvency, security, uptime, or conduct of these third parties. A failure, halt, or exploit at a third-party venue can affect the price, speed, or success of your swap, even though the route was selected by our software.</p>

          <h2>9. No guarantee of availability</h2>
          <p>The Service is provided on an “as is” and “as available” basis. Network congestion, RPC outages, third-party API failures, or maintenance can prevent you from trading, cancelling, or withdrawing at the time you want to. Plan accordingly, especially around volatile market conditions.</p>

          <h2>10. Only risk what you can afford to lose</h2>
          <p>Trading digital assets, and especially using leverage, perpetual futures, or cross-chain routes: can result in the rapid and total loss of the funds involved. Only use the Service with funds you can afford to lose in full.</p>

          <h2>11. Questions</h2>
          <p>Questions about this disclosure? Reach us through the official Suwappu Telegram or at <code>legal@suwappu.bot</code>.</p>
        </div>
        </article>
      </div>
      <SummerFooter />
    </main>
  );
}
