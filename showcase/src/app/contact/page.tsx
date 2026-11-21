import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import EnterpriseContactForm from '@/components/EnterpriseContactForm';
import DemoCallCta from '@/components/DemoCallCta';
import { Reveal, Backdrop, BoundaryRings } from '@/components/v3';
import '../sales-v3.css';
import styles from './contact.module.css';
import stats from '@/data/stats.generated.json';

export const metadata: Metadata = {
  title: 'Talk to the team',
  description:
    'Enterprise execution for desks and agent fleets: 0.1% swap fee, dedicated rate limits, and priority support. Tell us what you’re building and our team will follow up fast.',
};

const trust = [
  { text: 'KMS envelope encryption: managed-wallet keys are encrypted with AWS KMS, never handled in the clear.' },
  { text: 'Self-custody option: bring your own keys via the agent API for full non-custodial execution.' },
  { text: 'Spending limits, 2FA, and withdrawal allowlists on every account.' },
  { text: `Best-price routing across ${stats.routerCount} integrated providers on ${stats.platformChains} chains.` },
  { text: 'SOC 2 on our roadmap: happy to walk your security team through our controls under NDA.', note: true },
];

export default function ContactPage() {
  return (
    <div className="summer-page docs-shell institutional-page v3-tone-light sv3-page">
      <SummerNav />
      <main id="main-content">
      <div className="summer-shell mkt-page">
        <div className="sv3-heroband"><Backdrop kind="grid" /><header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Enterprise</p>
          <h1>Talk to the team.</h1>
          <p className="mkt-hero__lead">
            For trading desks, OTC desks, funds, and teams building agent fleets: a 0.1% swap
            fee, dedicated rate limits, and priority support. Tell us what you&rsquo;re building and
            we&rsquo;ll get back to you fast.
          </p>
        </header></div>

        {/* Saphira-style gate: the fastest path is a 30-min call, not the form. */}
        <Reveal as="section" className={`${styles.demoCard} sv3-demo`}>
          <div>
            <h2 className="mkt-h2">Book a 30-min demo.</h2>
            <p className={styles.demoBody}>
              Skip the form: grab time with our team directly and we&rsquo;ll walk through rate
              limits, custody model, and integration for your desk or agent fleet live.
            </p>
          </div>
          <DemoCallCta source="contact_page_card" className="summer-button summer-button--primary">
            Schedule a demo
          </DemoCallCta>
        </Reveal>

        <Reveal as="section" className={`${styles.layout} sv3-contact`}>
          <div className={`${styles.pitch} sv3-next v3-tone-dark`}>
            <div className="sv3-slab__art" aria-hidden="true"><BoundaryRings quiet /></div>
            <h2 className="mkt-h2">
              {stats.platformChains} chains, self-custody or managed keys, one agent API.
            </h2>
            <p>
              Prefer to send us a note first? Fill out the form and our team will follow up fast -
              or book the call above and skip straight to a conversation.
            </p>
            <p className={styles.trustLabel}>Security &amp; trust</p>
            <ul className={styles.trustList}>
              {trust.map((t) => (
                <li key={t.text}>
                  <span className={styles.check} aria-hidden="true">
                    ✓
                  </span>
                  <span className={t.note ? styles.note : undefined}>{t.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className={`${styles.panel} sv3-formpanel`}>
            <EnterpriseContactForm />
          </div>
        </Reveal>
      </div>
      </main>
      <SummerFooter />
    </div>
  );
}
