import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { Backdrop, Reveal, DeadEnd } from '@/components/v3';
import styles from './not-found.module.css';

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'That route does not exist. Head back to the homepage, the docs, or the status page.',
  // A 404 must never be indexed, but its outbound links should still be followed.
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="sw-dark v3-tone-dark">
      <SummerNav />
      <main id="main-content" className={`${styles.page} sw-grain sw-grain--dark`} style={{ overflow: 'clip' }}>
      <Backdrop kind="mesh" />
      <Backdrop kind="grid" />
      <div className={styles.inner}>
        <Reveal><DeadEnd stops={['Home', 'Docs', 'Status']} miss="404" /></Reveal>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>This route was never deployed.</h1>
        <p className={styles.lead}>
          The page you asked for does not exist: the link may be out of date, or the path may have moved.
        </p>

        <div className={styles.actions}>
          <a className={styles.primary} href="/">Back to homepage</a>
          <a className={styles.ghost} href="/docs">Documentation</a>
          <a className={styles.ghost} href="/status">System status</a>
        </div>

        <p className={styles.meta}>Error 404 · Not found</p>
      </div>
    </main>
      <SummerFooter />
    </div>
  );
}
