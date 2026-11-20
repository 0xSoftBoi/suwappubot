'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, TELEGRAM_URL } from '@/lib/links';
import { track } from '@/lib/analytics';
import { getAttribution } from '@/lib/attribution';
import { Field, FieldControl, FieldError, FieldLabel } from '@ui-sdk/react/field';
import { Input } from '@ui-sdk/react/input';
import { Textarea } from '@ui-sdk/react/textarea';
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
        <h2>Thanks: we&rsquo;ve got it.</h2>
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
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.row}>
        <Field name="name" className={styles.field}>
          <FieldLabel className={styles.label}>Name</FieldLabel>
          <Input className={styles.input} required autoComplete="name" placeholder="Priya Raghavan…" />
          <FieldError className={styles.fieldError} match="valueMissing">Enter your name.</FieldError>
        </Field>
        <Field name="company" className={styles.field}>
          <FieldLabel className={styles.label}>Company / desk</FieldLabel>
          <Input className={styles.input} required autoComplete="organization" placeholder="Meridian Digital…" />
          <FieldError className={styles.fieldError} match="valueMissing">Enter your company or desk.</FieldError>
        </Field>
      </div>

      <div className={styles.row}>
        <Field name="email" className={styles.field}>
          <FieldLabel className={styles.label}>Work email</FieldLabel>
          <Input
            className={styles.input}
            type="email"
            inputMode="email"
            required
            autoComplete="email"
            spellCheck={false}
            placeholder="priya@meridian.xyz…"
          />
          <FieldError className={styles.fieldError} match="valueMissing">Enter your work email.</FieldError>
          <FieldError className={styles.fieldError} match="typeMismatch">
            Enter an email address like priya@meridian.xyz.
          </FieldError>
        </Field>
        <Field name="telegram" className={styles.field}>
          <FieldLabel className={styles.label}>Telegram (optional)</FieldLabel>
          <Input className={styles.input} autoComplete="off" spellCheck={false} placeholder="@priyaonchain…" />
        </Field>
      </div>

      <div className={styles.row}>
        <Field name="country" className={styles.field}>
          <FieldLabel className={styles.label}>Country / jurisdiction (optional)</FieldLabel>
          <Input className={styles.input} autoComplete="country-name" placeholder="Singapore…" />
        </Field>
        <Field name="monthly_volume" className={styles.field}>
          <FieldLabel className={styles.label}>Monthly volume (optional)</FieldLabel>
          <FieldControl render={<select />} className={styles.input} defaultValue="">
            {VOLUME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FieldControl>
        </Field>
      </div>

      <Field name="use_case" className={styles.field}>
        <FieldLabel className={styles.label}>What are you looking to build? (optional)</FieldLabel>
        <Textarea
          className={styles.textarea}
          rows={4}
          placeholder="Agent fleet execution, OTC desk routing, dedicated rate limits…"
        />
      </Field>

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
        aria-busy={submitting}
      >
        {submitting && <span className={styles.spinner} aria-hidden="true" />}
        Talk to the team
      </button>
      <p className={styles.fineprint}>
        We&rsquo;ll only use these details to follow up about your request. No spam.
      </p>
    </form>
  );
}
