'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './growth.module.css';
import DailyChart from '@/components/charts/DailyChart';
import MiniTrend from '@/components/charts/MiniTrend';
import { CountUp, Reveal } from '@/components/v3';
import { getSolvePage } from '@/data/solve';

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
  // Added later on the API: absent on older versions, so always read defensively.
  landingPages?: LandingPage[];
  landingPagesTruncated?: boolean;
  aiReferrals?: { source: string; sessions: number }[];
};
type LandingPage = {
  path: string; slug: string | null; visitors: number; views: number; ctaClicks: number;
  snippetCopies: number; clickRate: number; topDestination: string | null; entrances: number;
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
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
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

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.tiles}>{children}</div>;
}

export function KpiTile(props: { label: string; value: string; hint?: React.ReactNode; count?: number; panel?: boolean; children?: React.ReactNode }) {
  const { label, value, hint, count, panel, children } = props;
  return (
    <div className={styles.tile}>
      <p className={styles.tileLabel}>{label}</p>
      {panel ? children : <p className={styles.tileValue}>{count !== undefined ? <CountUp value={count} duration={1100} /> : value}</p>}
      {hint && <p className={styles.tileHint}>{hint}</p>}
    </div>
  );
}

function Tile({ label, value, hint, now, before, days, count, spark }: {
  label: string; value: string; hint: string; now?: number; before?: number; days: number;
  /** Whole-number tiles count up on first view; others show the formatted value. */
  count?: number; spark?: number[];
}) {
  return (
    <div className={styles.tile}>
      <p className={styles.tileLabel}>{label}</p>
      <div className={styles.tileRow}>
        <p className={styles.tileValue}>{count !== undefined ? <CountUp value={count} duration={1100} /> : value}</p>
        {spark && <MiniTrend values={spark} />}
      </div>
      {now !== undefined && before !== undefined && <Change now={now} before={before} days={days} />}
      <p className={styles.tileHint}>{hint}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className={styles.skel} role="status" aria-label="Loading your numbers">
      <div className={styles.tiles}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={styles.tile}><i className={styles.sk} style={{ width: '40%' }} /><i className={styles.sk} style={{ width: '62%', height: 34, marginTop: 14 }} /><i className={styles.sk} style={{ width: '85%', marginTop: 16 }} /></div>
        ))}
      </div>
      <div className={styles.charts}>
        {[0, 1].map((i) => <div key={i} className={styles.chart}><i className={styles.sk} style={{ width: '30%' }} /><i className={styles.sk} style={{ height: 170, marginTop: 16 }} /></div>)}
      </div>
    </div>
  );
}

/** One measure per chart: signed baseline (refund days draw below zero), hover/arrow-key readout. */
function DailyBars({ title, unit, data, values, format = fmt, mode = 'area' }: {
  title: string; unit: [string, string]; data: Day[]; values: number[]; format?: (n: number) => string; mode?: 'area' | 'bars';
}) {
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartHead}>
        <span className={styles.chartTitle}>{title}</span>
        <span className={styles.chartReadout}>{values.some((v) => v !== 0) ? `${format(total)} total` : ''}</span>
      </figcaption>
      <DailyChart title={title} mode={mode} unit={unit[0] ? unit : undefined} format={format}
        formatAxis={format === fmt ? (n) => compact.format(n) : (n) => `$${compact.format(n)}`}
        points={data.map((d, i) => ({ label: d.date, value: values[i] }))} />
    </figure>
  );
}

const AI_NAMES: Record<string, string> = {
  'chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT', 'perplexity.ai': 'Perplexity', 'www.perplexity.ai': 'Perplexity',
  'claude.ai': 'Claude', 'gemini.google.com': 'Gemini', 'copilot.microsoft.com': 'Copilot',
};
const aiName = (s: string) => AI_NAMES[s.toLowerCase()] ?? s;

function destinationLabel(d: string | null): string {
  if (!d) return '—';
  const x = d.toLowerCase();
  if (x.includes('t.me')) return 'Telegram';
  if (x.includes('/start')) return 'Get an API key';
  if (x.includes('/contact')) return 'Talk to the team';
  if (x.includes('terminal')) return 'Terminal';
  return d;
}

type PageRow = LandingPage & { title: string; href: string };
type SortKey = 'visitors' | 'entrances' | 'ctaClicks' | 'clickRate' | 'snippetCopies';
const PAGE_COLS: { key: SortKey; label: string }[] = [
  { key: 'visitors', label: 'Visitors' }, { key: 'entrances', label: 'Started here' },
  { key: 'ctaClicks', label: 'Clicked the button' }, { key: 'clickRate', label: 'Click rate' },
  { key: 'snippetCopies', label: 'Copied code' },
];

/** Which /solve pages bring people in, and which of them get the button clicked. */
function ProblemPages({ pages, truncated }: { pages: LandingPage[]; truncated: boolean }) {
  const [sort, setSort] = useState<SortKey>('visitors');
  const rows: PageRow[] = useMemo(() => pages.map((p) => {
    const page = p.slug ? getSolvePage(p.slug) : undefined;
    return { ...p, title: page?.h1 ?? p.path, href: p.path };
  }), [pages]);
  const sorted = useMemo(() => [...rows].sort((a, b) => b[sort] - a[sort] || b.visitors - a.visitors), [rows, sort]);
  const best = useMemo(() => rows.filter((r) => r.slug && r.visitors > 0).sort((a, b) => b.visitors - a.visitors)[0], [rows]);
  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>Which problems bring people in — and which get clicked</h3>
      <p className={styles.panelHint}>
        {best
          ? <>“{best.title}” brought the most visitors ({fmt(best.visitors)}) and {(best.clickRate * 100).toFixed(1)}% clicked through.{' '}</>
          : null}
        Each row is a page that answers one question. “Started here” is how many people’s visit began on it.
      </p>
      {rows.length === 0 ? (
        <p className={styles.empty}><span className={styles.emptyMark} aria-hidden="true" />No visits to problem pages yet. They appear here as soon as someone lands on one.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Problem page</th>
                {PAGE_COLS.map((c) => (
                  <th key={c.key} scope="col" aria-sort={sort === c.key ? 'descending' : undefined}>
                    <button type="button" className={styles.sortBtn} onClick={() => setSort(c.key)}>{c.label}{sort === c.key ? ' ↓' : ''}</button>
                  </th>
                ))}
                <th scope="col">Where clicks go</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.path}>
                  <td data-label="Page"><a className={styles.link} href={r.href} target="_blank" rel="noreferrer">{r.title}</a></td>
                  <td data-label="Visitors">{fmt(r.visitors)}</td>
                  <td data-label="Started here">{fmt(r.entrances)}</td>
                  <td data-label="Clicked">{fmt(r.ctaClicks)}</td>
                  <td data-label="Click rate">
                    <span className={styles.rateCell}>
                      <span>{(r.clickRate * 100).toFixed(1)}%</span>
                      <span className={styles.rateTrack} aria-hidden="true"><span className={styles.rateFill} style={{ width: `${Math.min(100, Math.max(0, r.clickRate * 100))}%` }} /></span>
                    </span>
                  </td>
                  <td data-label="Copied code">{fmt(r.snippetCopies)}</td>
                  <td data-label="Clicks go to">{destinationLabel(r.topDestination)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {truncated ? <p className={styles.panelHint} style={{ margin: '10px 0 0' }}>Capped: only the busiest pages are shown.</p> : null}
    </div>
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
      {rows.length === 0 ? <p className={styles.empty}><span className={styles.emptyMark} aria-hidden="true" />{empty}</p> : (
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    load(`/admin/growth?days=${days}`)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, load, attempt]);

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
          <p className={styles.sub}>
            Visitors, sign-ups and sales leads from suwappu.bot.
            {report && <span className={styles.rangeCtx}>{dayLabel(report.window.from)} – {dayLabel(report.window.to)}, UTC</span>}
          </p>
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
            : 'These numbers could not be loaded right now. Nothing is lost; try again in a moment.'}
          {error !== 'UNAUTHORIZED' && (
            <button type="button" className={styles.retry} onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          )}
        </p>
      )}
      {!report && loading && <Skeleton />}

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

          <Reveal className={styles.tiles} stagger>
            <Tile days={report.days} label="Visitors" value={fmt(report.totals.visitors)}
              count={report.totals.visitors} spark={report.series.map((d) => d.visitors)} now={report.totals.visitors} before={report.previous.visitors}
              hint="Different people who opened the site." />
            <Tile days={report.days} label="Sales leads" value={fmt(report.totals.leads)}
              count={report.totals.leads} now={report.totals.leads} before={report.previous.leads}
              hint="People who sent the “Talk to the team” form." />
            <Tile days={report.days} label="All form sign-ups" value={fmt(report.totals.conversions)}
              count={report.totals.conversions} now={report.totals.conversions} before={report.previous.conversions}
              hint={`Leads ${fmt(report.totals.leads)} · newsletter ${fmt(report.totals.newsletter)} · mobile waitlist ${fmt(report.totals.mobileWaitlist)} · name reservations ${fmt(report.totals.reservations)}.`} />
            <Tile days={report.days} label="Visitor → sign-up rate"
              value={report.tracking.available ? pct(report.funnel[2]?.count ?? 0, report.totals.visitors) : '—'}
              hint="Out of every 100 visitors, how many filled in a form." />
            <Tile days={report.days} label="Money in"
              value={report.moneyIn.available ? usd(report.moneyIn.totalUsd) : '—'}
              spark={report.moneyIn.available ? report.series.map((d) => d.moneyInUsd) : undefined}
              now={report.moneyIn.available ? report.moneyIn.totalUsd : undefined}
              before={report.moneyIn.available ? report.moneyIn.previousUsd : undefined}
              hint={report.stripe.available
                ? 'Everything received in this period: card payments from Stripe (after refunds), swap fees, pay-per-call, API credits and agent plans.'
                : 'Payments recorded in this period. Card payments are NOT included because Stripe could not be read (see below).'} />
            <Tile days={report.days} label="New accounts" value={fmt(report.totals.signups)}
              count={report.totals.signups} spark={report.series.map((d) => d.signups)} now={report.totals.signups} before={report.previous.signups}
              hint="New user accounts created in the product." />
            <Tile days={report.days} label="Paying customers" value={fmt(report.paidCustomers.total)} count={report.paidCustomers.total}
              hint={`Active right now. Pro ${fmt(report.paidCustomers.byTier.pro ?? 0)} · Premium ${fmt(report.paidCustomers.byTier.premium ?? 0)} · Enterprise ${fmt(report.paidCustomers.byTier.enterprise ?? 0)}.`} />
          </Reveal>

          <div className={styles.charts}>
            <DailyBars title="Visitors per day" unit={['visitor', 'visitors']} data={report.series}
              values={report.series.map((d) => d.visitors)} />
            <DailyBars title="Form sign-ups per day" unit={['sign-up', 'sign-ups']} data={report.series}
              values={report.series.map((d) => d.leads + d.newsletter + d.mobileWaitlist + d.reservations)} mode="bars" />
          </div>

          <div className={styles.grid2}>
            <DailyBars title="Money in per day" unit={['', '']} format={usd} data={report.series}
              values={report.series.map((d) => d.moneyInUsd)} mode="bars" />
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
            ) : <p className={styles.empty}><span className={styles.emptyMark} aria-hidden="true" />No visits recorded in this period yet.</p>}
          </div>

          {Array.isArray(report.landingPages) ? (
            <ProblemPages pages={report.landingPages} truncated={!!report.landingPagesTruncated} />
          ) : null}

          {Array.isArray(report.aiReferrals) ? (
            <div className={styles.panel}>
              <h3 className={styles.panelTitle}>Visits sent by AI assistants</h3>
              <p className={styles.panelHint}>People who arrived from a link inside an AI assistant’s answer.</p>
              {report.aiReferrals.length === 0 ? (
                <p className={styles.empty}><span className={styles.emptyMark} aria-hidden="true" />None yet in this period.</p>
              ) : (
                <ul className={styles.rank}>
                  {report.aiReferrals.map((a) => (
                    <li key={a.source}>
                      <div className={styles.rankRow}>
                        <span className={styles.rankLabel} title={a.source}>{aiName(a.source)}</span>
                        <span className={styles.rankValue}>{fmt(a.sessions)} {a.sessions === 1 ? 'visit' : 'visits'}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

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
            {report.recentLeads.length === 0 ? <p className={styles.empty}><span className={styles.emptyMark} aria-hidden="true" />No leads yet. When someone sends the contact form, they appear here.</p> : (
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
                          <td data-label="When">{when(lead.createdAt)}</td>
                          <td data-label="Who">
                            <button type="button" className={styles.leadBtn} aria-expanded={open}
                              onClick={() => setOpenLead(open ? null : lead.id)}>
                              {lead.name ?? 'Name not given'}
                            </button>
                          </td>
                          <td data-label="Company">{lead.company ?? '—'}</td>
                          <td data-label="Email">{lead.email ? <a className={styles.link} href={`mailto:${encodeURIComponent(lead.email)}`}>{lead.email}</a> : '—'}</td>
                          <td data-label="Volume">{lead.monthlyVolume ?? '—'}</td>
                          <td data-label="From">{lead.source ?? 'Not tagged'}</td>
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
