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

export default function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || SKIP.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    // First-party only: PostHog and the other providers record their own page views.
    recordFirstParty('page_view');
  }, [pathname]);

  return null;
}
