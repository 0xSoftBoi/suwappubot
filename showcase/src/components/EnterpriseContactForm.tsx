'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, TELEGRAM_URL } from '@/lib/links';
import { track } from '@/lib/analytics';
import { getAttribution } from '@/lib/attribution';
import styles from './EnterpriseContactForm.module.css';

type Status = 'idle' | 'submitting' | 'success' | 'error';

const VOLUME_OPTIONS = [
  { value: '', label: 'Monthly swap volume (optional)' },
  { value: '<$100k', label: 'Under $100k' },
  { value: '$100k–$1M', label: '$100k – $1M' },
  { value: '$1M–$10M', label: '$1M – $10M' },
  { value: '$10M+', label: '$10M+' },
];

export default function EnterpriseContactForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    track('contact_sales_view');
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get('name') || '').trim(),
      company: String(data.get('company') || '').trim(),
      email: String(data.get('email') || '').trim(),
      country: String(data.get('country') || '').trim(),
      monthly_volume: String(data.get('monthly_volume') || '').trim(),
      use_case: String(data.get('use_case') || '').trim(),
      telegram: String(data.get('telegram') || '').trim(),
      website: String(data.get('website') || ''), // honeypot
      attribution: getAttribution() || undefined,
    };

    try {
      const res = await fetch(`${API_BASE_URL}/webapp/enterprise-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = 'Something went wrong. Please try again or reach us on Telegram.';
        try {
          const body = await res.json();
          if (body?.detail) detail = body.detail;
        } catch {
          /* ignore parse error */
        }
        setError(detail);
        setStatus('error');
        track('contact_sales_error');
        return;
      }
      setStatus('success');
      const attribution = payload.attribution;
      track('enterprise_lead_submitted', {
        company: payload.company || 'unknown',
        ...(attribution?.utm_source ? { utm_source: attribution.utm_source } : {}),
        ...(attribution?.utm_campaign ? { utm_campaign: attribution.utm_campaign } : {}),
      });
    } catch {
      setError('Could not reach the server. Please try again or message us on Telegram.');
      setStatus('error');
      track('contact_sales_error');
    }
  }

  if (status === 'success') {
    return (
      <div className={styles.success} role="status" aria-live="polite">
        <div className={styles.successMark} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              className={styles.successMarkPath}
              d="M4.5 12.5L10 18L19.5 6.5"
              stroke="#fff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2>Thanks — we&rsquo;ve got it.</h2>
        <p>
          Your request is in front of our team now. We reply within one business day, often much
          faster. Want to talk sooner?
        </p>
        <a
          className="summer-button summer-button--primary"
          href={TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Message us on Telegram
        </a>
      </div>
    );
  }

  const submitting = status === 'submitting';

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Name *</span>
          <input
            className={styles.input}
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder="Priya Raghavan"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Company / desk *</span>
          <input
            className={styles.input}
            name="company"
            type="text"
            required
            autoComplete="organization"
            placeholder="Meridian Digital"
          />
        </label>
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Work email *</span>
          <input
            className={styles.input}
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="priya@meridian.xyz"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Telegram (optional)</span>
          <input
            className={styles.input}
            name="telegram"
            type="text"
            autoComplete="off"
            placeholder="@priyaonchain"
          />
        </label>
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Country / jurisdiction (optional)</span>
          <input
            className={styles.input}
            name="country"
            type="text"
            autoComplete="country-name"
            placeholder="Singapore"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Monthly volume (optional)</span>
          <select className={styles.input} name="monthly_volume" defaultValue="">
            {VOLUME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>What are you looking to build? (optional)</span>
        <textarea
          className={styles.textarea}
          name="use_case"
          rows={4}
          placeholder="Agent fleet execution, OTC desk routing, dedicated rate limits…"
        />
      </label>

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
        {submitting ? 'Sending…' : 'Talk to the team'}
      </button>
      <p className={styles.fineprint}>
        We&rsquo;ll only use these details to follow up about your request. No spam.
      </p>
    </form>
  );
}
