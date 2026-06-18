import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';

export const metadata: Metadata = {
  title: 'Privacy Policy — Suwappu',
  description: 'What data Suwappu collects, how it is used, and how it is protected.',
};

export default function PrivacyPage() {
  return (
    <main className="summer-page docs-shell">
      <Navigation />
      <div className="summer-shell mkt-page">
        <article className="legal-page">
          <p className="summer-kicker">Legal</p>
          <h1>Privacy Policy</h1>
          <p className="legal-page__updated">Last updated: June 18, 2026</p>

          <h2>1. What we collect</h2>
          <p>To provide the Service we process: account identifiers (e.g. a Telegram ID or generated API key), wallet addresses and on-chain transaction data, trade and quote requests, and basic technical data (IP, request metadata) needed to operate and secure the Service. On-chain activity is inherently public; we do not control the blockchains we route across.</p>

          <h2>2. Keys and managed wallets</h2>
          <p>If you bring your own keys, we never receive them. If you use a managed wallet, private keys are encrypted with envelope encryption and signed server-side; access is restricted and logged. See our <a href="/security">Security</a> page for details.</p>

          <h2>3. How we use data</h2>
          <p>We use data to execute and settle your requests, prevent abuse and fraud, enforce limits and rate-limiting, provide support, and improve the Service. We do not sell your personal data.</p>

          <h2>4. Sharing &amp; sub-processors</h2>
          <p>We share data only as needed to operate the Service — for example with infrastructure, key-management, and routing providers (liquidity aggregators, bridges, and venues) that execute your transactions, and where required by law. These providers process data under their own terms and our agreements with them.</p>

          <h2>5. Security</h2>
          <p>We encrypt secrets at rest (AES-256-GCM) and data in transit (TLS), restrict access to sensitive material, and submit our wallet and key paths to independent review. No system is perfectly secure; you share responsibility by safeguarding your credentials.</p>

          <h2>6. Retention</h2>
          <p>We keep data for as long as needed to provide the Service and meet legal, security, and accounting obligations, then delete or anonymize it. Some on-chain records cannot be deleted because they live on public blockchains.</p>

          <h2>7. Your choices</h2>
          <p>You may request access to, correction of, or deletion of personal data we hold about you, subject to legal limits and the immutable nature of on-chain data. Contact us using the details below.</p>

          <h2>8. Cookies</h2>
          <p>Our web surfaces use only the cookies and local storage necessary to function and to understand aggregate usage. We do not use third-party advertising trackers.</p>

          <h2>9. Changes</h2>
          <p>We may update this policy; material changes are reflected by the “Last updated” date above.</p>

          <h2>10. Contact</h2>
          <p>Privacy questions? Reach us through the official Suwappu Telegram or at <code>privacy@suwappu.bot</code>.</p>
        </article>
      </div>
      <SummerFooter />
    </main>
  );
}
