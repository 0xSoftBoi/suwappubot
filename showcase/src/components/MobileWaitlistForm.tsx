'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, TELEGRAM_URL } from '@/lib/links';
import { track } from '@/lib/analytics';
import { getAttribution } from '@/lib/attribution';
import styles from './MobileWaitlistForm.module.css';

type Status = 'idle' | 'submitting' | 'success' | 'error';
type Platform = 'ios' | 'android' | 'both';

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: 'both', label: 'iOS & Android' },
  { value: 'ios', label: 'iOS only' },
  { value: 'android', label: 'Android only' },
];

export default function MobileWaitlistForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<number | null>(null);

  useEffect(() => {
    track('mobile_waitlist_view');
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      email: String(data.get('email') || '').trim(),
      name: String(data.get('name') || '').trim(),
      platform: String(data.get('platform') || 'both'),
      telegram: String(data.get('telegram') || '').trim(),
      website: String(data.get('website') || ''), // honeypot
      attribution: getAttribution() || undefined,
    };

    try {
      const res = await fetch(`${API_BASE_URL}/webapp/mobile-waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = 'Something went wrong. Please try again in a moment.';
        try {
          const body = await res.json();
          if (body?.detail) detail = body.detail;
        } catch {
          /* ignore parse error */
        }
        setError(detail);
        setStatus('error');
        track('mobile_waitlist_error');
        return;
      }
      let nextPosition: number | null = null;
      try {
        const body = await res.json();
        if (typeof body?.position === 'number') nextPosition = body.position;
      } catch {
        /* older backend / no JSON body — fall back to generic success copy */
      }
      setPosition(nextPosition);
      setStatus('success');
      const attribution = payload.attribution;
      track('mobile_waitlist_submitted', {
        platform: payload.platform,
        ...(nextPosition !== null ? { position: nextPosition } : {}),
        ...(attribution?.utm_source ? { utm_source: attribution.utm_source } : {}),
        ...(attribution?.utm_campaign ? { utm_campaign: attribution.utm_campaign } : {}),
      });
    } catch {
      setError('Could not reach the server. Please try again or message us on Telegram.');
      setStatus('error');
      track('mobile_waitlist_error');
    }
  }

  if (status === 'success') {
    return (
      <div className={styles.success} role="status" aria-live="polite">
        {position !== null ? (
          <>
            <div className={styles.positionStat}>
              <strong>#{position.toLocaleString()}</strong>
              <span>on the list</span>
            </div>
            <p>
              You&rsquo;re on the list. We&rsquo;ll email you the moment the app — and
              the Suwappu Card by Rain — is ready for your device.
            </p>
          </>
        ) : (
          <>
            <div className={styles.successMark} aria-hidden="true">
              ✓
            </div>
            <h3>You&rsquo;re on the list.</h3>
            <p>
              We&rsquo;ll email you the moment the app — and the Suwappu Card by Rain —
              is ready for your device.
            </p>
          </>
        )}
      </div>
    );
  }

  const submitting = status === 'submitting';

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Email *</span>
          <input
            className={styles.input}
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Platform</span>
          <select className={styles.input} name="platform" defaultValue="both">
            {PLATFORM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Name (optional)</span>
          <input
            className={styles.input}
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Jane Doe"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Telegram (optional)</span>
          <input
            className={styles.input}
            name="telegram"
            type="text"
            autoComplete="off"
            placeholder="@janedoe"
          />
        </label>
      </div>

      {/* Honeypot: hidden from humans, catches bots. */}
      <div className={styles.honeypot} aria-hidden="true">
        <label>
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <button
        className="summer-button summer-button--primary"
        type="submit"
        disabled={submitting}
      >
        {submitting ? 'Joining…' : 'Join the waitlist'}
      </button>
      <p className={styles.fineprint}>
        We&rsquo;ll only email you about the mobile app launch. No spam.{' '}
        <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
          Questions? Message us.
        </a>
      </p>
    </form>
  );
}
