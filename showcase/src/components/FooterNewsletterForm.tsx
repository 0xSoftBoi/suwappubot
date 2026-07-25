'use client';

import { useState } from 'react';
import { API_BASE_URL } from '@/lib/links';
import { track } from '@/lib/analytics';
import { getAttribution } from '@/lib/attribution';

type Status = 'idle' | 'submitting' | 'success' | 'error';

/**
 * Compact newsletter capture for the footer. Kept as its own client
 * component so SummerFooter itself can stay a server component — only this
 * small island hydrates.
 */
export default function FooterNewsletterForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      email: String(data.get('email') || '').trim(),
      website: String(data.get('website') || ''), // honeypot
      attribution: getAttribution() || undefined,
    };

    try {
      const res = await fetch(`${API_BASE_URL}/webapp/newsletter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = 'Something went wrong. Please try again.';
        try {
          const body = await res.json();
          if (body?.detail) detail = body.detail;
        } catch {
          /* ignore parse error */
        }
        setError(detail);
        setStatus('error');
        return;
      }
      setStatus('success');
      form.reset();
      track('newsletter_subscribed');
    } catch {
      setError('Could not reach the server. Please try again.');
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <p className="summer-footer__newsletter-status summer-footer__newsletter-status--success" role="status">
        You&rsquo;re subscribed — watch your inbox.
      </p>
    );
  }

  const submitting = status === 'submitting';

  return (
    <form className="summer-footer__newsletter" onSubmit={handleSubmit} noValidate>
      <h4>Get launch + alpha updates</h4>
      <div className="summer-footer__newsletter-form">
        <label className="summer-footer__newsletter-honeypot" aria-hidden="true">
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
        <input
          className="summer-footer__newsletter-input"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
        />
        <button
          className="summer-footer__newsletter-submit"
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting && <span className="summer-footer__newsletter-spinner" aria-hidden="true" />}
          {submitting ? 'Joining…' : 'Subscribe'}
        </button>
      </div>
      {error && (
        <p className="summer-footer__newsletter-status summer-footer__newsletter-status--error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
