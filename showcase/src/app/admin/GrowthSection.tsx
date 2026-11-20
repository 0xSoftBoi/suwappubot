'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './growth.module.css';

/**
 * Growth: the marketing + sales funnel, written for a non-technical reader.
 *
 * Every number has a plain-language label and a one-line "what this means".
 * Data: GET /admin/growth (api-ts routes/adminGrowth.ts).
 */

type Totals = {
  visitors: number; pageViews: number; leads: number; newsletter: number;
  mobileWaitlist: number; reservations: number; signups: number; conversions: number;
};
type Day = Omit<Totals, 'conversions'> & { date: string; moneyInUsd: number };
type Lead = {
  id: number; status: string; createdAt: string | null; name: string | null; company: string | null;
  email: string | null; country: string | null; monthlyVolume: string | null; telegram: string | null;
  useCase: string | null; source: string | null; campaign: string | null;
};
export type GrowthReport = {
  days: number;
  window: { from: string; to: string };
  generatedAt: string;
  tracking: { available: boolean; firstEventAt: string | null };
  totals: Totals;
  previous: Totals;
  paidCustomers: { total: number; byTier: Record<string, number> };
  moneyIn: { available: boolean; totalUsd: number; previousUsd: number; bySource: { key: string; label: string; usd: number }[] };
  planEstimate: { monthlyUsd: number; prices: Record<string, number> };
  stripe:
    | { available: false }
    | { available: true; receivedUsd: number; refundedUsd: number; disputedUsd: number; feesUsd: number; netUsd: number; payments: number; previousReceivedUsd: number; nonUsdSkipped: number; truncated: boolean };
  funnel: { key: string; label: string; count: number }[];
  series: Day[];
  topPages: { path: string; views: number; visitors: number }[];
  topSources: { source: string; visitors: number; conversions: number }[];
  topEvents: { name: string; count: number; visitors: number }[];
  leadSources: { source: string; count: number }[];
  recentLeads: Lead[];
};

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const;

const nf = new Intl.NumberFormat(undefined);
const fmt = (n: number) => nf.format(n);
const uf = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const usd = (n: number) => uf.format(n);
const pct = (part: number, whole: number) =>
  whole > 0 ? `${(part / whole * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : '0%';
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

// Friendly names for the event slugs the site fires.
const EVENT_LABELS: Record<string, string> = {
  cta_clicked: 'Clicked a main button',
  upgrade_click: 'Clicked an upgrade button',
  demo_call_click: 'Clicked “Schedule a demo”',
  contact_sales_view: 'Opened the contact form',
  contact_sales_error: 'Contact form failed to send',
  enterprise_lead_submitted: 'Sent the contact form',
  newsletter_subscribed: 'Joined the newsletter',
  mobile_waitlist_view: 'Opened the mobile waitlist',
  mobile_waitlist_submitted: 'Joined the mobile waitlist',
  mobile_waitlist_error: 'Mobile waitlist failed to send',
  waitlist_reserve_view: 'Opened “Reserve your name”',
  waitlist_reserved: 'Reserved a name',
  waitlist_reserve_error: 'Name reservation failed',
  waitlist_share_clicked: 'Shared their referral link',
  waitlist_referral_copied: 'Copied their referral link',
};

function Change({ now, before, days }: { now: number; before: number; days: number }) {
  if (before === 0 && now === 0) return <span className={styles.changeFlat}>No change</span>;
  if (before === 0) return <span className={styles.changeUp}>▲ New this period</span>;
  const delta = (now - before) / before * 100;
  const up = delta >= 0;
  return (
    <span className={up ? styles.changeUp : styles.changeDown}>
      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}% vs the {days} days before
    </span>
  );
}

function Tile({ label, value, hint, now, before, days }: {
  label: string; value: string; hint: string; now?: number; before?: number; days: number;
}) {
  return (
    <div className={styles.tile}>
      <p className={styles.tileLabel}>{label}</p>
      <p className={styles.tileValue}>{value}</p>
      {now !== undefined && before !== undefined && <Change now={now} before={before} days={days} />}
      <p className={styles.tileHint}>{hint}</p>
    </div>
  );
}

/** One measure per chart, one hue, baseline at zero. Hover or focus a bar for the exact value. */
function DailyBars({ title, unit, data, values, format = fmt }: {
  title: string; unit: [string, string]; data: Day[]; values: number[]; format?: (n: number) => string;
}) {
  const u = (n: number) => (unit[0] ? ` ${n === 1 ? unit[0] : unit[1]}` : '');
  const [active, setActive] = useState<number | null>(null);
  // Signed scale: money can go backwards (a refund day), so bars below the
  // zero line are real and must not be drawn as small positive ones.
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const span = top - bottom || 1;
  const total = values.reduce((a, b) => a + b, 0);
  const anyActivity = values.some((v) => v !== 0);
  const W = 640, H = 150, PAD_B = 22, PAD_T = 8;
  const plotH = H - PAD_B - PAD_T;
  const zeroY = PAD_T + (top / span) * plotH;
  const slot = W / Math.max(1, values.length);
  const barW = Math.max(2, slot - 2); // 2px surface gap between adjacent bars
  const tickEvery = Math.ceil(values.length / 6);
  const shown = active ?? values.length - 1;

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartHead}>
        <span className={styles.chartTitle}>{title}</span>
        <span className={styles.chartReadout} aria-live="polite">
          {data[shown] ? `${dayLabel(data[shown].date)}: ${format(values[shown])}${u(values[shown])}` : ''}
        </span>
      </figcaption>
      {!anyActivity ? (
        <p className={styles.empty}>Nothing recorded in this period yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg} role="img"
          aria-label={`${title}: ${format(total)}${u(total)} in total, highest day ${format(top)}${bottom < 0 ? `, lowest day ${format(bottom)}` : ''}.`}
          onMouseLeave={() => setActive(null)}>
          <line x1="0" x2={W} y1={zeroY} y2={zeroY} className={styles.axis} />
          {values.map((v, i) => {
            const h = v === 0 ? 0 : Math.max(2, (Math.abs(v) / span) * plotH);
            const x = i * slot + (slot - barW) / 2;
            return (
              <g key={data[i].date}>
                {/* Hit target is the full column, larger than the mark. */}
                <rect x={i * slot} y={0} width={slot} height={H - PAD_B} fill="transparent"
                  tabIndex={0} aria-label={`${dayLabel(data[i].date)}: ${format(v)}${u(v)}`}
                  onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                  className={styles.hit} />
                <rect x={x} y={v >= 0 ? zeroY - h : zeroY} width={barW} height={h} rx={Math.min(3, barW / 2)}
                  className={v < 0 ? styles.barNegative : i === shown ? styles.barActive : styles.bar} pointerEvents="none" />
                {i % tickEvery === 0 && (
                  <text x={i * slot + slot / 2} y={H - 6} textAnchor="middle" className={styles.tick}>
                    {dayLabel(data[i].date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </figure>
  );
}

function RankList({ title, hint, rows, empty, format = fmt }: {
  title: string; hint: string; empty: string; format?: (n: number) => string;
  rows: { key: string; label: string; value: number; note?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>{title}</h3>
      <p className={styles.panelHint}>{hint}</p>
      {rows.length === 0 ? <p className={styles.empty}>{empty}</p> : (
        <ul className={styles.rank}>
          {rows.map((r) => (
            <li key={r.key}>
              <div className={styles.rankRow}>
                <span className={styles.rankLabel} title={r.label}>{r.label}</span>
                <span className={styles.rankValue}>{format(r.value)}{r.note ? <em> · {r.note}</em> : null}</span>
              </div>
              <div className={styles.rankTrack} aria-hidden="true">
                <div className={styles.rankFill} style={{ width: `${Math.max(2, r.value / max * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GrowthSection({ load }: { load: (path: string) => Promise<GrowthReport> }) {
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<GrowthReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openLead, setOpenLead] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    load(`/admin/growth?days=${days}`)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, load]);

  const headline = useMemo(() => {
    if (!report) return '';
    const t = report.totals;
    if (!report.tracking.available) {
      return `In the last ${report.days} days: ${fmt(t.leads)} sales leads and ${fmt(t.signups)} new accounts. Visitor tracking has not started yet.`;
    }
    return `In the last ${report.days} days, ${fmt(t.visitors)} ${t.visitors === 1 ? 'person' : 'people'} visited the site. ${fmt(t.conversions)} ${t.conversions === 1 ? 'form was' : 'forms were'} sent in, including ${fmt(t.leads)} sales ${t.leads === 1 ? 'lead' : 'leads'}.${report.moneyIn.available ? ` ${usd(report.moneyIn.totalUsd)} came in${report.stripe.available ? '' : ', not counting card payments'}.` : ''}`;
  }, [report]);

  return (
    <section id="growth" className={styles.root} aria-labelledby="growth-title">
      <div className={styles.head}>
        <div>
          <h2 id="growth-title" className={styles.title}>Is it working?</h2>
          <p className={styles.sub}>Visitors, sign-ups and sales leads from suwappu.bot.</p>
        </div>
        <div className={styles.ranges} role="group" aria-label="Time period">
          {RANGES.map((r) => (
            <button key={r.days} type="button" aria-pressed={days === r.days}
              className={days === r.days ? styles.rangeActive : styles.range} onClick={() => setDays(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error === 'UNAUTHORIZED'
            ? 'Your sign-in has expired. Sign out and sign in again.'
            : 'These numbers could not be loaded right now. Refresh the page to try again.'}
        </p>
      )}
      {!report && loading && <p className={styles.empty}>Loading your numbers…</p>}

      {report && (
        <div className={loading ? styles.stale : undefined}>
          <p className={styles.headline}>{headline}</p>

          {!report.tracking.available && (
            <p className={styles.notice}>
              <strong>Visitor tracking is not switched on yet.</strong> Leads, sign-ups and customers below are
              real. Visitor counts start the first time the updated site and API are both deployed.
            </p>
          )}
          {report.tracking.available && report.tracking.firstEventAt &&
            new Date(report.tracking.firstEventAt).getTime() > new Date(`${report.window.from}T00:00:00Z`).getTime() && (
            <p className={styles.notice}>
              Visitor tracking started on {when(report.tracking.firstEventAt)}, so visitor numbers before that
              date are zero and the “vs before” comparison is not meaningful yet.
            </p>
          )}

          <div className={styles.tiles}>
            <Tile days={report.days} label="Visitors" value={fmt(report.totals.visitors)}
              now={report.totals.visitors} before={report.previous.visitors}
              hint="Different people who opened the site." />
            <Tile days={report.days} label="Sales leads" value={fmt(report.totals.leads)}
              now={report.totals.leads} before={report.previous.leads}
              hint="People who sent the “Talk to the team” form." />
            <Tile days={report.days} label="All form sign-ups" value={fmt(report.totals.conversions)}
              now={report.totals.conversions} before={report.previous.conversions}
              hint={`Leads ${fmt(report.totals.leads)} · newsletter ${fmt(report.totals.newsletter)} · mobile waitlist ${fmt(report.totals.mobileWaitlist)} · name reservations ${fmt(report.totals.reservations)}.`} />
            <Tile days={report.days} label="Visitor → sign-up rate"
              value={report.tracking.available ? pct(report.funnel[2]?.count ?? 0, report.totals.visitors) : '—'}
              hint="Out of every 100 visitors, how many filled in a form." />
            <Tile days={report.days} label="Money in"
              value={report.moneyIn.available ? usd(report.moneyIn.totalUsd) : '—'}
              now={report.moneyIn.available ? report.moneyIn.totalUsd : undefined}
              before={report.moneyIn.available ? report.moneyIn.previousUsd : undefined}
              hint={report.stripe.available
                ? 'Everything received in this period: card payments from Stripe (after refunds), swap fees, pay-per-call, API credits and agent plans.'
                : 'Payments recorded in this period. Card payments are NOT included because Stripe could not be read (see below).'} />
            <Tile days={report.days} label="New accounts" value={fmt(report.totals.signups)}
              now={report.totals.signups} before={report.previous.signups}
              hint="New user accounts created in the product." />
            <Tile days={report.days} label="Paying customers" value={fmt(report.paidCustomers.total)}
              hint={`Active right now. Pro ${fmt(report.paidCustomers.byTier.pro ?? 0)} · Premium ${fmt(report.paidCustomers.byTier.premium ?? 0)} · Enterprise ${fmt(report.paidCustomers.byTier.enterprise ?? 0)}.`} />
          </div>

          <div className={styles.charts}>
            <DailyBars title="Visitors per day" unit={['visitor', 'visitors']} data={report.series}
              values={report.series.map((d) => d.visitors)} />
            <DailyBars title="Form sign-ups per day" unit={['sign-up', 'sign-ups']} data={report.series}
              values={report.series.map((d) => d.leads + d.newsletter + d.mobileWaitlist + d.reservations)} />
          </div>

          <div className={styles.grid2}>
            <DailyBars title="Money in per day" unit={['', '']} format={usd} data={report.series}
              values={report.series.map((d) => d.moneyInUsd)} />
            <RankList title="Where the money came from" format={usd}
              hint="Money received in this period, by type."
              empty="No payments recorded in this period yet."
              rows={report.moneyIn.bySource.filter((m) => m.usd > 0).map((m) => ({ key: m.key, label: m.label, value: m.usd }))} />
          </div>
          {report.stripe.available ? (
            <div className={styles.panel}>
              <h3 className={styles.panelTitle}>Card payments (from Stripe)</h3>
              <p className={styles.panelHint}>
                Read live from your Stripe balance for this period, so it includes monthly plans and card top-ups.
              </p>
              <dl className={styles.ledger}>
                <div><dt>Received from {fmt(report.stripe.payments)} {report.stripe.payments === 1 ? 'payment' : 'payments'}</dt><dd>{usd(report.stripe.receivedUsd)}</dd></div>
                <div><dt>Refunded to customers</dt><dd>−{usd(report.stripe.refundedUsd)}</dd></div>
                <div><dt>Lost to disputes (chargebacks)</dt><dd>−{usd(report.stripe.disputedUsd)}</dd></div>
                <div><dt>Stripe’s processing fees</dt><dd>−{usd(report.stripe.feesUsd)}</dd></div>
                <div className={styles.ledgerTotal}><dt>What you keep</dt><dd>{usd(report.stripe.netUsd)}</dd></div>
              </dl>
              {(report.stripe.truncated || report.stripe.nonUsdSkipped > 0) && (
                <p className={styles.panelHint}>
                  {report.stripe.truncated && 'There were too many transactions to read in one go, so these totals may be low. '}
                  {report.stripe.nonUsdSkipped > 0 && `${fmt(report.stripe.nonUsdSkipped)} non-USD ${report.stripe.nonUsdSkipped === 1 ? 'transaction is' : 'transactions are'} not included.`}
                </p>
              )}
            </div>
          ) : (
            <p className={styles.note}>
              <strong>Card payments are missing from the money numbers.</strong> Stripe could not be read just
              now, so “Money in” only counts payments this system records itself. As a guide, your{' '}
              {fmt(report.paidCustomers.total)} active paid {report.paidCustomers.total === 1 ? 'plan is' : 'plans are'}{' '}
              worth about <strong>{usd(report.planEstimate.monthlyUsd)} a month</strong> at list price.
            </p>
          )}

          <div className={styles.panel}>
            <h3 className={styles.panelTitle}>From visit to sign-up</h3>
            <p className={styles.panelHint}>How far visitors got. A big drop between two steps is where to focus.</p>
            {report.tracking.available && report.totals.visitors > 0 ? (
              <ol className={styles.funnel}>
                {report.funnel.map((step, i) => (
                  <li key={step.key}>
                    <div className={styles.rankRow}>
                      <span className={styles.rankLabel}>{i + 1}. {step.label}</span>
                      <span className={styles.rankValue}>
                        {fmt(step.count)}<em> · {pct(step.count, report.totals.visitors)} of visitors</em>
                      </span>
                    </div>
                    <div className={styles.rankTrack} aria-hidden="true">
                      <div className={styles.rankFill}
                        style={{ width: `${Math.max(1, step.count / report.totals.visitors * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className={styles.empty}>No visits recorded in this period yet.</p>}
          </div>

          <div className={styles.grid2}>
            <RankList title="Where visitors come from" hint="The site or campaign that sent them. “direct” means they typed the address or used a bookmark."
              empty="No visits recorded in this period yet."
              rows={report.topSources.map((s) => ({ key: s.source, label: s.source, value: s.visitors,
                note: s.conversions ? `${fmt(s.conversions)} signed up` : undefined }))} />
            <RankList title="Most visited pages" hint="Which pages people actually look at."
              empty="No visits recorded in this period yet."
              rows={report.topPages.map((p) => ({ key: p.path, label: p.path === '/' ? 'Home page' : p.path, value: p.views }))} />
            <RankList title="What visitors did" hint="Buttons clicked and forms opened or sent."
              empty="No actions recorded in this period yet."
              rows={report.topEvents.map((e) => ({ key: e.name, label: EVENT_LABELS[e.name] ?? e.name.replace(/_/g, ' '), value: e.count }))} />
            <RankList title="Where sign-ups came from" hint="The campaign tag on leads and sign-ups, when there was one."
              empty="No sign-ups in this period yet."
              rows={report.leadSources.map((s) => ({ key: s.source, label: s.source, value: s.count }))} />
          </div>

          <div className={styles.panel}>
            <h3 className={styles.panelTitle}>Latest sales leads</h3>
            <p className={styles.panelHint}>
              Everyone who sent the “Talk to the team” form, newest first. Select a row to read what they asked for.
            </p>
            {report.recentLeads.length === 0 ? <p className={styles.empty}>No leads yet. When someone sends the contact form, they appear here.</p> : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Company</th><th scope="col">Email</th><th scope="col">Monthly volume</th><th scope="col">Came from</th></tr>
                  </thead>
                  <tbody>
                    {report.recentLeads.map((lead) => {
                      const open = openLead === lead.id;
                      return [
                        <tr key={lead.id} className={open ? styles.rowOpen : undefined}>
                          <td>{when(lead.createdAt)}</td>
                          <td>
                            <button type="button" className={styles.leadBtn} aria-expanded={open}
                              onClick={() => setOpenLead(open ? null : lead.id)}>
                              {lead.name ?? 'Name not given'}
                            </button>
                          </td>
                          <td>{lead.company ?? '—'}</td>
                          <td>{lead.email ? <a className={styles.link} href={`mailto:${encodeURIComponent(lead.email)}`}>{lead.email}</a> : '—'}</td>
                          <td>{lead.monthlyVolume ?? '—'}</td>
                          <td>{lead.source ?? 'Not tagged'}</td>
                        </tr>,
                        open && (
                          <tr key={`${lead.id}-detail`} className={styles.detail}>
                            <td colSpan={6}>
                              <dl>
                                <div><dt>What they want to build</dt><dd>{lead.useCase ?? 'Not given'}</dd></div>
                                <div><dt>Country</dt><dd>{lead.country ?? 'Not given'}</dd></div>
                                <div><dt>Telegram</dt><dd>{lead.telegram ?? 'Not given'}</dd></div>
                                <div><dt>Campaign</dt><dd>{lead.campaign ?? 'Not tagged'}</dd></div>
                              </dl>
                            </td>
                          </tr>
                        ),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className={styles.foot}>
            Updated {when(report.generatedAt)}. Days are counted in UTC. Visitor counts are anonymous: no names,
            emails or IP addresses are stored for visits.
          </p>
        </div>
      )}
    </section>
  );
}
