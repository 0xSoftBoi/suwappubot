'use client';

/**
 * Billing panel for the web dashboard.
 *
 * Everything a paying customer previously had to open Telegram (or email us)
 * for: current plan + upgrade, prepaid API credit balance + card top-up,
 * invoice history, and payment-method / cancellation management via the
 * Stripe-hosted billing portal.
 *
 * All money movement happens on Stripe's hosted pages — this component only
 * asks the API for a URL and sends the browser there. Pack pricing is resolved
 * server-side from CREDIT_PACKS; the client only names a pack id.
 */

import { useCallback, useEffect, useState } from 'react';
import styles from '../dashboard.module.css';

// ── Types (mirror api-ts/src/routes/billing.ts responses) ───────────────────

/** `chargeUsd` is what Stripe charges; `balanceUsd` is what lands in the balance. */
interface CreditPack {
  id: string;
  chargeUsd: number;
  balanceUsd: number;
  bonusPct: number;
}

/** All amounts are USD — `api_credits` is a USD-denominated balance. */
interface CreditsResponse {
  balance_usd: number;
  lifetime_purchased_usd: number;
  lifetime_used_usd: number;
  packs: CreditPack[];
}

interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  amountDueUsd: number;
  amountPaidUsd: number;
  currency: string;
  createdAt: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  description: string | null;
}

interface InvoicesResponse {
  invoices: Invoice[];
  has_customer: boolean;
}

interface BillingStatus {
  tier: string;
  fee_rate_percent: number;
  expires_at: string | null;
  active: boolean;
}

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

interface BillingPanelProps {
  apiFetch: ApiFetch;
  /** Plan tier from the org record — used as a fallback if /billing/status 404s. */
  fallbackTier?: string;
  /** Renewal date from the org subscription record. */
  renewsAt?: string;
  /** Plan limits. These describe what the plan buys, so they belong beside it
      rather than in a separate card competing for the same attention. */
  rateLimitPerMin?: number;
  seatsUsed?: number;
  seatLimit?: number | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const UPGRADE_TIERS = [
  { id: 'pro', label: 'Pro', usd: 9.99, blurb: '0.5% swap fee · higher rate limits' },
  { id: 'premium', label: 'Premium', usd: 29.99, blurb: '0.3% swap fee · priority routing' },
] as const;

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

/** Read an { error } body without throwing on a non-JSON response. */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export default function BillingPanel({
  apiFetch,
  fallbackTier,
  renewsAt,
  rateLimitPerMin,
  seatsUsed,
  seatLimit,
}: BillingPanelProps) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [credits, setCredits] = useState<CreditsResponse | null>(null);
  const [invoices, setInvoices] = useState<InvoicesResponse | null>(null);

  const [loading, setLoading] = useState(true);
  // Which action is mid-flight — disables every button so a double-click can't
  // open two Stripe sessions.
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, creditsRes, invoicesRes] = await Promise.all([
        apiFetch('/billing/status'),
        apiFetch('/billing/credits'),
        apiFetch('/billing/invoices'),
      ]);

      // Each panel section degrades independently — a Stripe outage that breaks
      // invoices must not blank out the credit balance.
      if (statusRes.ok) setStatus(await statusRes.json());
      if (creditsRes.ok) setCredits(await creditsRes.json());
      if (invoicesRes.ok) setInvoices(await invoicesRes.json());
    } catch {
      setErr('Could not load billing details. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  // Surface the result of a Stripe redirect back onto the dashboard.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const topup = params.get('topup');
    if (topup === 'success') {
      setNotice(
        'Top-up received. Your balance updates once Stripe confirms the payment — usually within a few seconds.',
      );
      // Balance is granted by the webhook, which may land just after the
      // redirect; re-read shortly after so the number is not stale.
      const t = setTimeout(() => void load(), 3000);
      return () => clearTimeout(t);
    }
    if (topup === 'cancel') setNotice('Top-up cancelled — no charge was made.');
  }, [load]);

  /** POST an endpoint that returns { url } and send the browser there. */
  const goToStripe = useCallback(
    async (key: string, path: string, init?: RequestInit) => {
      setBusy(key);
      setErr(null);
      try {
        const res = await apiFetch(path, init);
        if (!res.ok) {
          setErr(await readError(res, 'Stripe is unavailable right now. Try again shortly.'));
          return;
        }
        const body = await res.json();
        if (!body?.url) {
          setErr('Stripe did not return a checkout link. Try again shortly.');
          return;
        }
        window.location.href = body.url;
      } catch {
        setErr('Could not reach the billing service. Check your connection and retry.');
      } finally {
        setBusy(null);
      }
    },
    [apiFetch],
  );

  const buyPack = (packId: string) =>
    goToStripe(`pack:${packId}`, '/billing/credits/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId }),
    });

  const openPortal = () => goToStripe('portal', '/billing/portal', { method: 'POST' });

  const upgrade = (tier: string) =>
    goToStripe(`tier:${tier}`, `/billing/stripe/checkout?tier=${tier}&format=json`);

  const tier = status?.tier ?? fallbackTier ?? 'free';
  const isPaid = tier !== 'free';
  const anyBusy = busy !== null;

  return (
    <section className={styles.card} aria-label="Billing and credits">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Billing &amp; Credits</h2>
        <button
          className={styles.actionBtn}
          onClick={() => void load()}
          disabled={loading || anyBusy}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {notice && (
        <p className={styles.billingNotice} role="status">
          {notice}
        </p>
      )}
      {err && (
        <p className={styles.billingError} role="alert">
          {err}
        </p>
      )}

      {/* ── Plan ─────────────────────────────────────────────────────────── */}
      <div className={styles.billingBlock}>
        <h3 className={styles.billingBlockTitle}>Plan</h3>
        <div className={styles.billingPlanRow}>
          <div className={styles.billingPlan}>
            <span className={styles.tierBadge}>{tier.toUpperCase()}</span>
            <span className={styles.billingPlanName}>
              {status ? `${status.fee_rate_percent}% swap fee` : '—'}
            </span>
          </div>
          {(status?.expires_at || renewsAt) && (
            <span className={styles.billingMeta}>
              Renews {fmtDate(status?.expires_at ?? renewsAt)}
            </span>
          )}
          <div className={styles.billingStatusPill} data-status={status?.active ? 'active' : 'past_due'}>
            <span className={styles.billingStatusDot} />
            {status?.active ? 'Active' : 'Inactive'}
          </div>
        </div>

        <div className={styles.packGrid}>
          {UPGRADE_TIERS.map((t) => {
            const current = tier === t.id;
            return (
              <div key={t.id} className={styles.packCard} data-current={current || undefined}>
                <div className={styles.packHead}>
                  <span className={styles.packName}>{t.label}</span>
                  <span className={styles.packPrice}>{fmtUsd(t.usd)}/mo</span>
                </div>
                <p className={styles.packBlurb}>{t.blurb}</p>
                <button
                  className={`${styles.actionBtn} ${styles['actionBtn--create']}`}
                  onClick={() => void upgrade(t.id)}
                  disabled={current || anyBusy}
                >
                  {current
                    ? 'Current plan'
                    : busy === `tier:${t.id}`
                      ? 'Opening Stripe…'
                      : `Switch to ${t.label}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Plan limits — what the tier above actually buys. */}
        {(rateLimitPerMin !== undefined || seatLimit) && (
          <div className={styles.planLimits}>
            {rateLimitPerMin !== undefined && (
              <div className={styles.planLimit}>
                <span className={styles.billingMeta}>Rate limit</span>
                <span className={styles.mono}>{rateLimitPerMin.toLocaleString()} req/min</span>
              </div>
            )}
            {seatLimit ? (
              <div className={styles.planLimit}>
                <span className={styles.billingMeta}>Seats</span>
                <span className={styles.mono}>
                  {seatsUsed ?? 0} / {seatLimit}
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Credits ──────────────────────────────────────────────────────── */}
      <div className={styles.billingBlock}>
        <h3 className={styles.billingBlockTitle}>API credits</h3>

        <div className={styles.creditSummary}>
          <div className={styles.creditBalance}>
            <span className={styles.creditBalanceLabel}>Balance</span>
            <span className={styles.creditBalanceValue}>
              {credits ? fmtUsd(credits.balance_usd) : '—'}
            </span>
            <span className={styles.creditBalanceUsd}>
              {credits ? 'Available for metered API usage' : ''}
            </span>
          </div>
          <div className={styles.creditStats}>
            <div>
              <span className={styles.billingMeta}>Purchased</span>
              <span className={styles.mono}>
                {credits ? fmtUsd(credits.lifetime_purchased_usd) : '—'}
              </span>
            </div>
            <div>
              <span className={styles.billingMeta}>Used</span>
              <span className={styles.mono}>
                {credits ? fmtUsd(credits.lifetime_used_usd) : '—'}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.packGrid}>
          {(credits?.packs ?? []).map((p) => (
            <div key={p.id} className={styles.packCard}>
              <div className={styles.packHead}>
                <span className={styles.packName}>{fmtUsd(p.balanceUsd)} balance</span>
                <span className={styles.packPrice}>{fmtUsd(p.chargeUsd)}</span>
              </div>
              <p className={styles.packBlurb}>
                {p.bonusPct > 0
                  ? `+${p.bonusPct}% bonus — pay ${fmtUsd(p.chargeUsd)}, get ${fmtUsd(p.balanceUsd)}`
                  : 'Pay as you go'}
              </p>
              <button
                className={`${styles.actionBtn} ${styles['actionBtn--create']}`}
                onClick={() => void buyPack(p.id)}
                disabled={anyBusy}
              >
                {busy === `pack:${p.id}` ? 'Opening Stripe…' : 'Top up'}
              </button>
            </div>
          ))}
          {!loading && (credits?.packs ?? []).length === 0 && (
            <p className={styles.billingMeta}>
              Credit top-ups are temporarily unavailable. Contact support if you need capacity now.
            </p>
          )}
        </div>
      </div>

      {/* ── Invoices & payment methods ───────────────────────────────────── */}
      <div className={styles.billingBlock}>
        <div className={styles.cardHead} style={{ marginBottom: 12 }}>
          <h3 className={styles.billingBlockTitle} style={{ margin: 0 }}>
            Invoices
          </h3>
          <button
            className={styles.actionBtn}
            onClick={() => void openPortal()}
            disabled={anyBusy || invoices?.has_customer === false}
            title={
              invoices?.has_customer === false
                ? 'Available once you have completed a card payment'
                : 'Manage payment methods, download receipts, or cancel'
            }
          >
            {busy === 'portal' ? 'Opening Stripe…' : 'Manage payment methods'}
          </button>
        </div>

        {invoices && invoices.invoices.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className={styles.mono}>{inv.number ?? inv.id}</td>
                  <td>{fmtDate(inv.createdAt)}</td>
                  <td className={styles.mono}>
                    {fmtUsd(inv.amountPaidUsd || inv.amountDueUsd)}
                  </td>
                  <td>{inv.status ?? '—'}</td>
                  <td>
                    {inv.invoicePdfUrl || inv.hostedInvoiceUrl ? (
                      <a
                        className={styles.invoiceLink}
                        href={inv.invoicePdfUrl ?? inv.hostedInvoiceUrl ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {inv.invoicePdfUrl ? 'PDF' : 'View'}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.billingMeta}>
            {loading
              ? 'Loading invoices…'
              : 'No invoices yet. They appear here after your first card payment.'}
          </p>
        )}
      </div>
    </section>
  );
}
