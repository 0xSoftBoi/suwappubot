'use client';

import styles from '../dashboard.module.css';

interface ComingOnlineProps {
  icon: React.ReactNode;
  title: string;
  lead: string;
}

/**
 * Shared empty-state card for enterprise dashboard sections that are still
 * being built (Treasury, Transactions, Policies, Compliance, Audit,
 * Security — see docs/plans/enterprise-dashboard.md). Each route stays
 * self-contained: this only supplies the shared "coming online" shell so
 * later work can drop real content into the page without touching the frame
 * or re-deriving the empty-state visual.
 */
export default function ComingOnline({ icon, title, lead }: ComingOnlineProps) {
  return (
    <section className={styles.comingSoon} aria-label={title}>
      <span className={styles.comingSoonIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.comingSoonBadge}>Coming online</span>
      <h1 className={styles.comingSoonTitle}>{title}</h1>
      <p className={styles.comingSoonLead}>{lead}</p>
    </section>
  );
}
