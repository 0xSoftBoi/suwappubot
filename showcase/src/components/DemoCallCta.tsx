'use client';

/**
 * Enterprise "Schedule a demo" CTA: Saphira-style gate for institutional
 * surfaces. Plain link to the Calendly booking page (no embedded widget/
 * script: keeps the page light and avoids a jarring third-party iframe).
 * Fires `demo_call_click` with a `source` prop so we can see which
 * enterprise surface drives bookings.
 */
import { DEMO_CALL_URL } from '@/lib/links';
import { track } from '@/lib/analytics';

interface DemoCallCtaProps {
  source: string;
  className: string;
  children: React.ReactNode;
}

export default function DemoCallCta({ source, className, children }: DemoCallCtaProps) {
  return (
    <a
      className={className}
      href={DEMO_CALL_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track('demo_call_click', { source })}
    >
      {children}
    </a>
  );
}
