import type { Metadata } from 'next';
import stats from '@/data/stats.generated.json';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';
import { Reveal, Backdrop, SpotlightCard, MiniViz, AuthorityFlow, BoundaryRings, type MiniKind, ProblemStrip } from '@/components/v3';
import '../sales-v3.css';
import styles from './security.module.css';

/** Pictogram per practice, same order as `buckets`. */
const bucketKinds: MiniKind[] = ['tee', 'custody', 'cipher', 'gate', 'simulate', 'review', 'window'];

export const metadata: Metadata = {
  title: 'Security',
  description:
    'How Suwappu protects keys and funds: KMS envelope encryption, Turnkey-held managed-wallet keys, self-custody options, spending limits, MEV-resistant routes, and responsible disclosure.',
};

const buckets = [
  {
    title: 'Key management',
    body: 'Managed-wallet signing keys are held with Turnkey. Where encrypted backups exist, they use envelope encryption (`kms_aesgcm_v2`): a per-record AES-256-GCM data key wrapped by a KMS-managed key, with key wrapping moving behind an AWS KMS IAM boundary. Legacy Fernet-encrypted keys auto-migrate to the v2 scheme.',
  },
  {
    title: 'Custody, your choice',
    body: 'Bring your own keys via the agent API for full self-custody: Suwappu never sees them. Or use a managed wallet, where keys are encrypted at rest and signed server-side so your agent never handles a private key.',
  },
  {
    title: 'Data protection',
    body: 'Secrets are encrypted at rest with AES-256-GCM; all traffic is TLS-encrypted in transit. Sensitive material is segregated from application data, and API keys are shown exactly once at creation.',
  },
  {
    title: 'Account controls',
    body: 'Per-key and per-account guardrails: spending limits, allowed chains and pairs, withdrawal allowlists, and TOTP two-factor authentication, so autonomous agents act strictly inside the rails you define.',
  },
  {
    title: 'Execution safety',
    body: 'Where the pair is eligible, swaps can use MEV-resistant routes such as CoW, with token-security checks (anti-rug heuristics) and transaction simulation before funds move.',
  },
  {
    title: 'Independent review',
    body: 'Our wallet and key-management paths have undergone independent red-team review, with findings tracked and remediated. Formal third-party certifications and protocol audits are on the roadmap: we publish status rather than badges we have not earned.',
  },
  {
    title: 'Rate limits & agent metering',
    body: 'Every key is rate-limited by a sliding-window limiter scoped to your tier, so no single caller can starve the API. Pay-per-call (x402) credit balances are metered per agent and deducted atomically: one agent’s usage or balance can never draw against another’s.',
  },
];

export default function SecurityPage() {
  return (
    <div className="summer-page docs-shell institutional-page v3-tone-light sv3-page">
      <SummerNav />
      <main id="main-content">
      <div className="summer-shell mkt-page">
        <div className="sv3-heroband"><Backdrop kind="grid" /><header className="mkt-hero">
          <h1>Built to move money safely.</h1>
          <p className="mkt-hero__lead">
            How keys, funds and data are protected across {stats.platformChains} chains, and what we
            have not yet certified.
          </p>
          <div className="summer-actions">
            <a className="summer-button summer-button--primary" href="/contact">Talk to the team</a>
            <a className="summer-button summer-button--secondary" href="#disclosure">Report a vulnerability</a>
          </div>
</header></div>

        {/* Authority model, drawn: two custody lanes through a policy gate, and the
            rings of controls around a single key. Decorative; the practices below
            carry the real statements. */}
        <Reveal stagger className="sv3-duo" >
          <div className="sv3-stage">
            <AuthorityFlow lanes={[['Your keys', 'Unsigned tx', 'Chain'], ['Turnkey wallet', 'Policy', 'Chain']]} />
          </div>
          <div className="sv3-stage sv3-stage--dark">
            <div className="v3-framed"><BoundaryRings labels={['Key', 'Turnkey', 'KMS wrap', 'IAM boundary', 'Server policy']} /></div>
          </div>
        </Reveal>

        <Reveal stagger as="section" className="v3-bento sv3-practices">
          {buckets.map((b, i) => (
            <SpotlightCard
              key={b.title}
              index={String(i + 1).padStart(2, '0')}
              title={b.title}
              visual={<MiniViz kind={bucketKinds[i]} />}
              className={i < 2 ? 'v3-span-2' : i === buckets.length - 1 ? 'sv3-tile-split' : undefined}
              style={i === buckets.length - 1 ? { gridColumn: '1 / -1' } : undefined}
            >
              {b.body}
            </SpotlightCard>
          ))}
        </Reveal>

        <Reveal as="section" id="disclosure" className={styles.disclose}>
          <div>
            <p className="summer-kicker">Report a vulnerability</p>
            <h2 className="mkt-h2">Found something? Tell us.</h2>
            <p>
              We welcome reports from security researchers. Email{' '}
              <code>security@suwappu.bot</code> with details and reproduction steps. Please
              give us a reasonable window to remediate before public disclosure; we do not
              pursue good-faith researchers.
            </p>
            <p>
              To report: email <a href="mailto:security@suwappu.bot">security@suwappu.bot</a>,
              say what you found, which URL or endpoint it affects, and the steps to reproduce
              it. The same contact, policy link and expiry are machine-readable in{' '}
              <a href="/.well-known/security.txt">security.txt</a>.
            </p>
          </div>
          <div className={styles.honesty}>
            <h3>What we claim, and what we don&apos;t</h3>
            <ul>
              <li><b>Real today:</b> Turnkey-held managed-wallet keys, KMS envelope encryption, self-custody option, spending limits, 2FA, per-tier rate limits, per-agent metering isolation, independent red-team review.</li>
              <li><b>On the roadmap:</b> SOC 2, public smart-contract / protocol audit reports, a self-serve trust portal.</li>
              <li>We&apos;d rather state status plainly than display certifications we haven&apos;t earned.</li>
            </ul>
          </div>
        </Reveal>

        <section className="mkt-cta">
          <h2>Trade with guardrails you control.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href="/contact">
              Talk to the team
            </a>
            <a className="summer-button summer-button--secondary" href="/docs/authentication/overview">
              Read the auth docs
            </a>
          </div>
        </section>
      </div>
      <div className="summer-shell"><ProblemStrip surface="security" slugs={["is-a-telegram-trading-bot-safe", "spending-limits-ai-agent-wallet", "audit-log-for-trading-agents"]} /></div>
      </main>
      <SummerFooter />
    </div>
  );
}
