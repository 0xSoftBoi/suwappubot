import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';

export const metadata: Metadata = {
  title: 'Terms of Service — Suwappu',
  description: 'The terms governing your use of Suwappu’s bot, terminal, API, and SDK.',
};

export default function TermsPage() {
  return (
    <main id="main-content" className="summer-page docs-shell sw-dark">
      <Navigation />
      <div className="summer-shell mkt-page">
        <nav className="doc-breadcrumb">
          <a href="/">Home</a>
          <span className="doc-breadcrumb__sep">/</span>
          <span>Legal</span>
          <span className="doc-breadcrumb__sep">/</span>
          <span>Terms of Service</span>
        </nav>
        <article className="legal-page sw-measure">
        <div className="legal-page__card">
          <p className="summer-kicker">Legal</p>
          <h1>Terms of Service</h1>
          <p className="legal-page__updated">Last updated: June 18, 2026</p>

          <h2>1. Acceptance</h2>
          <p>By accessing or using Suwappu — including the Telegram bot, trading terminal, REST API, SDK, and MCP server (together, the “Service”) — you agree to these Terms. If you do not agree, do not use the Service.</p>

          <h2>2. Eligibility</h2>
          <p>You must be of legal age in your jurisdiction and not barred from using the Service under applicable law or sanctions programs. You are responsible for ensuring your use complies with the laws that apply to you, including any restrictions on trading digital assets or derivatives in your region.</p>

          <h2>3. The Service</h2>
          <p>Suwappu provides software for routing and executing cross-chain swaps and related on-chain actions. We are a software and routing provider, not a broker, exchange, custodian, or financial advisor. Certain features are provided by third parties (e.g. liquidity aggregators, bridges, and trading venues) and are subject to their own terms.</p>

          <h2>4. Accounts, wallets, and keys</h2>
          <p>You may use the Service with self-custodied keys (you retain sole control) or with a managed wallet (keys are encrypted and signed on your behalf, as described on our Security page). You are responsible for safeguarding your credentials, API keys, and any device used to access the Service. Activity conducted through your account is your responsibility.</p>

          <h2>5. Fees</h2>
          <p>Swaps are subject to a fee determined by your subscription tier, disclosed on our Pricing page, plus any network gas and third-party costs. Fees may change with notice. Subscriptions renew until cancelled and are non-refundable except where required by law.</p>

          <h2>6. Acceptable use</h2>
          <p>You agree not to use the Service to break the law, launder funds, evade sanctions, manipulate markets, infringe others’ rights, or interfere with the Service’s operation or security. We may suspend or terminate access for conduct that violates these Terms or applicable law.</p>

          <h2 id="risk">7. Risk disclosures</h2>
          <p>Digital assets are volatile and trading carries substantial risk, including total loss. <strong>Only trade what you can afford to lose.</strong> See our full <a href="/legal/risk">Risk Disclosure</a> for a detailed breakdown of volatility, smart contract, bridge, custody, slippage/MEV, and regulatory risk.</p>

          <h2>8. No financial advice</h2>
          <p>The Service and any content within it are provided for informational purposes only and do not constitute financial, investment, legal, or tax advice. You are solely responsible for your trading decisions.</p>

          <h2>9. Disclaimers &amp; limitation of liability</h2>
          <p>The Service is provided “as is” and “as available,” without warranties of any kind. To the maximum extent permitted by law, Suwappu and its contributors are not liable for any indirect, incidental, special, or consequential damages, or for any loss of funds, profits, or data arising from your use of the Service or from third-party protocols and venues.</p>

          <h2>10. Changes</h2>
          <p>We may update these Terms from time to time. Material changes will be reflected by the “Last updated” date above; continued use after changes constitutes acceptance.</p>

          <h2>11. Contact</h2>
          <p>Questions about these Terms? Reach us through the official Suwappu Telegram or at <code>legal@suwappu.bot</code>.</p>
        </div>
        </article>
      </div>
      <SummerFooter />
    </main>
  );
}
