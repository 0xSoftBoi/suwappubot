'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { recordFirstParty } from '@/lib/analytics';

/**
 * Records one `page_view` per route the visitor lands on, including
 * client-side navigations. Internal surfaces are skipped so staff looking at
 * dashboards do not inflate the visitor numbers they are reading.
 */
const SKIP = ['/admin', '/dashboard'];

// Module-level on purpose: an effect can re-run for the same path when a
// Suspense/Activity boundary above it hides and reveals (seen on /start after a
// client navigation). A reload gets a fresh module, so it still counts.
let lastRecorded = '';

export default function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    // Remember skipped paths too. Otherwise home -> /admin -> home would look like
    // the same path twice in a row and the second home view would be dropped.
    const previous = lastRecorded;
    lastRecorded = pathname;
    if (SKIP.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    if (pathname === previous) return;
    // First-party only: PostHog and the other providers record their own page views.
    recordFirstParty('page_view');
  }, [pathname]);

  return null;
}
