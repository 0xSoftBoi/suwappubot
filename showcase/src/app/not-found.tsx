import type { Metadata } from 'next';
import styles from './not-found.module.css';

export const metadata: Metadata = {
  title: 'Page not found | Suwappu',
  description: 'That route does not exist. Head back to the homepage, the docs, or the status page.',
  // A 404 must never be indexed, but its outbound links should still be followed.
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main id="main-content" className={`${styles.page} sw-grain sw-grain--dark`}>
      <div className={styles.inner}>
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
  );
}
