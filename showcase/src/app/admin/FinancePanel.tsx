'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '@/lib/links';

interface LegacyScenario {
  name: 'survival' | 'base' | 'growth';
  inflowMultiplier: number;
  weeklyCashInflowUsd: number;
  weeklyNetCashUsd: number | null;
  endingCashUsd: number | null;
  runwayWeeks: number | null;
}

interface DriverScenario {
  name: 'downside' | 'base' | 'upside';
  assumptions: {
    initialVolumeMultiplier: number;
    initialNonFeeCashMultiplier: number;
    feeCaptureMultiplier: number;
    fixedBurnMultiplier: number;
    volumeGrowthPct: number;
    nonFeeCashGrowthPct: number;
    variableCostBps: number;
  };
  endingCashUsd: number | null;
  firstCashOutWeek: number | null;
  cumulativeCashInflowUsd: number;
  cumulativeNetCashUsd: number | null;
}

interface FinanceProvider {
  provider: string;
  total: number;
  completed: number;
  failed: number;
  successRate: number | null;
  volumeUsd: number;
  priceImprovementUsd: number;
}

interface FinanceResponse {
  success: true;
  asOf: string;
  windowDays: number;
  cashInflow: {
    tracked30dUsd: number;
    weeklyRunRateUsd: number;
    sources: {
      directPaymentsUsd: number;
      prepaidCreditInflowsUsd: number;
      agentSubscriptionInflowsUsd: number;
      swapFeesCollectedUsd: number;
      swapFeesAccruedUsd: number;
    };
  };
  execution: {
    totalSwaps: number;
    completedSwaps: number;
    failedSwaps: number;
    successRate: number | null;
    volumeUsd: number;
    quotes: number;
    quotesWithExecution: number;
    quoteToExecutionRate: number | null;
    routeCandidates: number;
  };
  unitEconomics: {
    trackedCashInflowPerCompletedSwapUsd: number | null;
    feeCaptureBps: number | null;
    feeCollectionRate: number | null;
    trackedGasCostUsd: number;
    trackedFeeCostUsd: number;
    priceImprovementUsd: number;
    avgPriceImprovementUsd: number;
    apiCalls: number;
  };
  paymentCycles: {
    recurringActive: number;
    recurringOverdue: number;
    recurringDue7d: number;
    recurringDue30d: number;
    humanSubscriptionsExpiring30d: number;
    stripePaymentFailures30d: number;
  };
  processMining: {
    quoteToExecutionRate: number | null;
    quotesWithoutExecution: number;
    avgRouteCandidatesPerQuote: number | null;
    settlementLatencyP50Seconds: number;
    settlementLatencyP95Seconds: number;
    topFailureReasons: Array<{
      provider: string;
      error: string;
      count: number;
    }>;
  };
  resilience: {
    providerConcentration: {
      totalVolumeUsd: number;
      topProvider: string | null;
      topProviderShare: number | null;
      hhi: number | null;
      risk: 'unknown' | 'low' | 'moderate' | 'high';
    };
  };
  providers: FinanceProvider[];
  planning: {
    startingCashUsd: number | null;
    weeklyOperatingBurnUsd: number | null;
    variableCostBps: number | null;
    volumeGrowthPct: number | null;
    nonFeeGrowthPct: number | null;
    forecast: LegacyScenario[];
    driverForecast: DriverScenario[];
  };
  dataQuality: {
    complete: boolean;
    missing: string[];
    notes: string[];
  };
}

const STORAGE = {
  cash: 'suwappu_finance_cash_usd',
  burn: 'suwappu_finance_weekly_burn_usd',
  variableCostBps: 'suwappu_finance_variable_cost_bps',
  volumeGrowthPct: 'suwappu_finance_volume_growth_pct',
  nonFeeGrowthPct: 'suwappu_finance_non_fee_growth_pct',
};

function fmtUSD(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 3600) return `${(value / 3600).toFixed(1)}h`;
  if (value >= 60) return `${(value / 60).toFixed(1)}m`;
  return `${value.toFixed(1)}s`;
}

function numberFrom(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function answerFinanceQuestion(data: FinanceResponse, question: string): string {
  const q = question.toLowerCase();
  const base = data.planning.driverForecast.find((row) => row.name === 'base');
  const topFailure = data.processMining.topFailureReasons[0];
  const risk = data.resilience.providerConcentration;

  if (/runway|cash out|cash-out|13 week|13-week/.test(q)) {
    if (base?.endingCashUsd === null || base?.endingCashUsd === undefined) {
      return 'Runway is not computable yet because starting cash and weekly operating burn are not both supplied. Add them under scenario drivers; I will not invent a balance.';
    }
    const cashOut = base.firstCashOutWeek
      ? `Base case crosses zero in week ${base.firstCashOutWeek}.`
      : 'Base case stays above zero through the 13-week horizon.';
    return `${cashOut} Base-case ending cash is ${fmtUSD(base.endingCashUsd)} with cumulative net cash of ${fmtUSD(base.cumulativeNetCashUsd)}.`;
  }

  if (/provider|concentration|dependency|resilien|single point|vendor/.test(q)) {
    if (!risk.topProvider || risk.topProviderShare === null) return 'There is not enough routed volume in the 30-day window to calculate provider concentration.';
    return `${risk.topProvider} carries ${fmtPct(risk.topProviderShare)} of observed routed volume. HHI is ${risk.hhi ?? '—'}, which the control plane classifies as ${risk.risk} operational concentration risk.`;
  }

  if (/fail|bottleneck|process|latency|slow|rework/.test(q)) {
    const failure = topFailure
      ? ` The largest failure signature is "${topFailure.error}" on ${topFailure.provider} (${topFailure.count} events).`
      : ' No repeated failed-swap signature was observed.';
    return `Quote-to-execution is ${fmtPct(data.processMining.quoteToExecutionRate)}. Settlement latency is p50 ${fmtSeconds(data.processMining.settlementLatencyP50Seconds)} and p95 ${fmtSeconds(data.processMining.settlementLatencyP95Seconds)}.${failure}`;
  }

  if (/renew|payment|collection|overdue|subscription|dunning/.test(q)) {
    return `Recurring crypto billing: ${data.paymentCycles.recurringActive} active, ${data.paymentCycles.recurringOverdue} overdue, ${data.paymentCycles.recurringDue7d} due in 7 days. Human subscriptions expiring in 30 days: ${data.paymentCycles.humanSubscriptionsExpiring30d}. Stripe payment-failure events in the last 30 days: ${data.paymentCycles.stripePaymentFailures30d}.`;
  }

  if (/fee|margin|capture|unit economics/.test(q)) {
    return `Observed fee capture is ${data.unitEconomics.feeCaptureBps?.toFixed(1) ?? '—'} bps on ${fmtUSD(data.execution.volumeUsd)} of 30-day swap volume. Recorded fee collection rate is ${fmtPct(data.unitEconomics.feeCollectionRate)}. Measured routing price improvement totals ${fmtUSD(data.unitEconomics.priceImprovementUsd)}.`;
  }

  if (/volume|swap/.test(q)) {
    return `Thirty-day swap volume is ${fmtUSD(data.execution.volumeUsd)} across ${data.execution.totalSwaps.toLocaleString()} swaps, with ${fmtPct(data.execution.successRate)} terminal execution success.`;
  }

  if (/cash|inflow|revenue|money/.test(q)) {
    const s = data.cashInflow.sources;
    return `Tracked 30-day cash inflow is ${fmtUSD(data.cashInflow.tracked30dUsd)}: ${fmtUSD(s.directPaymentsUsd)} direct payments, ${fmtUSD(s.prepaidCreditInflowsUsd)} prepaid credits, ${fmtUSD(s.agentSubscriptionInflowsUsd)} agent subscriptions, and ${fmtUSD(s.swapFeesCollectedUsd)} collected swap fees. This is cash-flow telemetry, not GAAP revenue.`;
  }

  if (/quote|conversion|funnel/.test(q)) {
    return `${data.execution.quotesWithExecution.toLocaleString()} of ${data.execution.quotes.toLocaleString()} observed quotes linked to an execution (${fmtPct(data.execution.quoteToExecutionRate)}). ${data.processMining.quotesWithoutExecution.toLocaleString()} observed quotes did not link to an executed swap.`;
  }

  return 'I can answer admin-scoped questions about cash/runway, fees, swap volume, quote conversion, payment cycles, provider concentration, failures, and execution latency. The answers are computed from the loaded control-plane data and never send finance data to a third-party model.';
}

export default function FinancePanel({ apiKey }: { apiKey: string }) {
  const [cash, setCash] = useState('');
  const [burn, setBurn] = useState('');
  const [variableCostBps, setVariableCostBps] = useState('');
  const [volumeGrowthPct, setVolumeGrowthPct] = useState('');
  const [nonFeeGrowthPct, setNonFeeGrowthPct] = useState('');
  const [data, setData] = useState<FinanceResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState('What is our biggest bottleneck?');

  useEffect(() => {
    setCash(localStorage.getItem(STORAGE.cash) ?? '');
    setBurn(localStorage.getItem(STORAGE.burn) ?? '');
    setVariableCostBps(localStorage.getItem(STORAGE.variableCostBps) ?? '');
    setVolumeGrowthPct(localStorage.getItem(STORAGE.volumeGrowthPct) ?? '');
    setNonFeeGrowthPct(localStorage.getItem(STORAGE.nonFeeGrowthPct) ?? '');
  }, []);

  const planningParams = useMemo(() => {
    const params = new URLSearchParams();
    const values: Array<[string, string, number | null]> = [
      ['cash_usd', cash, numberFrom(cash)],
      ['weekly_burn_usd', burn, numberFrom(burn)],
      ['variable_cost_bps', variableCostBps, numberFrom(variableCostBps)],
      ['volume_growth_pct', volumeGrowthPct, numberFrom(volumeGrowthPct)],
      ['non_fee_growth_pct', nonFeeGrowthPct, numberFrom(nonFeeGrowthPct)],
    ];
    for (const [key, raw, value] of values) {
      if (raw.trim() && value !== null) params.set(key, String(value));
    }
    return params;
  }, [cash, burn, variableCostBps, volumeGrowthPct, nonFeeGrowthPct]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const suffix = planningParams.size ? `?${planningParams.toString()}` : '';
      const res = await fetch(`${API_BASE_URL}/admin/finance${suffix}`, {
        headers: { 'X-Admin-Key': apiKey },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json() as FinanceResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load finance control plane');
    } finally {
      setLoading(false);
    }
  }, [apiKey, planningParams]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyPlanningInputs() {
    const checks: Array<[string, string, number, number]> = [
      [cash, 'Starting cash', 0, 1_000_000_000_000],
      [burn, 'Weekly burn', 0, 1_000_000_000_000],
      [variableCostBps, 'Variable cost bps', 0, 10_000],
      [volumeGrowthPct, 'Weekly volume growth', -50, 100],
      [nonFeeGrowthPct, 'Weekly non-fee cash growth', -50, 100],
    ];
    for (const [raw, label, min, max] of checks) {
      if (!raw.trim()) continue;
      const n = numberFrom(raw);
      if (n === null || n < min || n > max) {
        setError(`${label} must be between ${min} and ${max}.`);
        return;
      }
    }

    const entries: Array<[string, string]> = [
      [STORAGE.cash, cash],
      [STORAGE.burn, burn],
      [STORAGE.variableCostBps, variableCostBps],
      [STORAGE.volumeGrowthPct, volumeGrowthPct],
      [STORAGE.nonFeeGrowthPct, nonFeeGrowthPct],
    ];
    for (const [key, value] of entries) {
      if (value.trim()) localStorage.setItem(key, value.trim());
      else localStorage.removeItem(key);
    }
    void load();
  }

  const nlqAnswer = data ? answerFinanceQuestion(data, question) : '';

  return (
    <div className="adm-section" id="finance" style={{ scrollMarginTop: 24 }}>
      <div className="adm-section__head">
        <div>
          <h2 className="adm-section__title">Founder Operating System</h2>
          <span className="adm-section__meta">Cash, unit economics, payment cycles, process mining, resilience, and 13-week drivers</span>
        </div>
        <button className="adm-export-btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="adm-error">Finance view unavailable: {error}</div>}
      {!data && loading && <div className="adm-loading">Loading founder operating system…</div>}

      {data && (
        <>
          <div className="adm-stats">
            <div className="adm-stat">
              <div className="adm-stat__label">Tracked cash inflow · 30d</div>
              <div className="adm-stat__value">{fmtUSD(data.cashInflow.tracked30dUsd)}</div>
              <div className="adm-stat__sub">{fmtUSD(data.cashInflow.weeklyRunRateUsd)} trailing weekly run-rate</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Swap volume · 30d</div>
              <div className="adm-stat__value">{fmtUSD(data.execution.volumeUsd)}</div>
              <div className="adm-stat__sub">{data.execution.totalSwaps.toLocaleString()} swaps</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Execution success</div>
              <div className="adm-stat__value">{fmtPct(data.execution.successRate)}</div>
              <div className="adm-stat__sub">{data.execution.completedSwaps.toLocaleString()} completed / {data.execution.failedSwaps.toLocaleString()} failed</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Quote → execution</div>
              <div className="adm-stat__value">{fmtPct(data.execution.quoteToExecutionRate)}</div>
              <div className="adm-stat__sub">{data.processMining.quotesWithoutExecution.toLocaleString()} quotes without linked execution</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Fee capture</div>
              <div className="adm-stat__value">{data.unitEconomics.feeCaptureBps === null ? '—' : `${data.unitEconomics.feeCaptureBps.toFixed(1)} bps`}</div>
              <div className="adm-stat__sub">{fmtPct(data.unitEconomics.feeCollectionRate)} recorded collection</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Provider concentration</div>
              <div className="adm-stat__value">{data.resilience.providerConcentration.risk}</div>
              <div className="adm-stat__sub">
                {data.resilience.providerConcentration.topProvider ?? '—'} {fmtPct(data.resilience.providerConcentration.topProviderShare)} · HHI {data.resilience.providerConcentration.hhi ?? '—'}
              </div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Settlement latency p95</div>
              <div className="adm-stat__value">{fmtSeconds(data.processMining.settlementLatencyP95Seconds)}</div>
              <div className="adm-stat__sub">p50 {fmtSeconds(data.processMining.settlementLatencyP50Seconds)}</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Payment risk · 30d</div>
              <div className="adm-stat__value">{data.paymentCycles.stripePaymentFailures30d}</div>
              <div className="adm-stat__sub">{data.paymentCycles.recurringOverdue} crypto renewals overdue</div>
            </div>
          </div>

          <div className="adm-section__head" style={{ marginTop: 24 }}>
            <div>
              <h3 className="adm-section__title" style={{ fontSize: '1rem' }}>Ask finance</h3>
              <span className="adm-section__meta">Admin-scoped deterministic NLQ. No finance data is sent to an external LLM.</span>
            </div>
          </div>
          <div className="adm-stats" style={{ marginBottom: 20 }}>
            <div className="adm-stat" style={{ gridColumn: '1 / -1' }}>
              <input
                className="adm-auth__input"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Why are swaps failing? What is our provider concentration? What is runway?"
              />
              <div className="adm-stat__sub" style={{ marginTop: 10, lineHeight: 1.55 }}>{nlqAnswer}</div>
            </div>
          </div>

          <div className="adm-section__head">
            <div>
              <h3 className="adm-section__title" style={{ fontSize: '1rem' }}>13-week driver model</h3>
              <span className="adm-section__meta">Actual volume + fee capture + collection + non-fee inflow + explicit founder-entered cost drivers.</span>
            </div>
          </div>

          <div className="adm-stats" style={{ marginBottom: 14 }}>
            {[
              ['finance-cash', 'Starting cash (USD)', cash, setCash, '50000'],
              ['finance-burn', 'Weekly fixed burn (USD)', burn, setBurn, '3000'],
              ['finance-var-cost', 'Variable cost (bps of volume)', variableCostBps, setVariableCostBps, '5'],
              ['finance-vol-growth', 'Weekly volume growth (%)', volumeGrowthPct, setVolumeGrowthPct, '2'],
              ['finance-nonfee-growth', 'Weekly non-fee cash growth (%)', nonFeeGrowthPct, setNonFeeGrowthPct, '1'],
            ].map(([id, label, value, setter, placeholder]) => (
              <div className="adm-stat" key={String(id)}>
                <label className="adm-stat__label" htmlFor={String(id)}>{String(label)}</label>
                <input
                  id={String(id)}
                  className="adm-auth__input"
                  inputMode="decimal"
                  placeholder={String(placeholder)}
                  value={String(value)}
                  onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                />
              </div>
            ))}
            <div className="adm-stat" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
              <button className="adm-auth__btn" onClick={applyPlanningInputs} style={{ marginTop: 12 }}>
                Reforecast
              </button>
            </div>
          </div>

          <div className="adm-table-wrap" style={{ marginBottom: 24 }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Volume start</th>
                  <th>Non-fee cash start</th>
                  <th>Fee capture</th>
                  <th>Fixed burn</th>
                  <th>13-week inflow</th>
                  <th>13-week net</th>
                  <th>Ending cash</th>
                  <th>Cash-out</th>
                </tr>
              </thead>
              <tbody>
                {data.planning.driverForecast.map((scenario) => (
                  <tr key={scenario.name}>
                    <td><strong>{scenario.name.charAt(0).toUpperCase() + scenario.name.slice(1)}</strong></td>
                    <td>{scenario.assumptions.initialVolumeMultiplier.toFixed(2)}×</td>
                    <td>{scenario.assumptions.initialNonFeeCashMultiplier.toFixed(2)}×</td>
                    <td>{scenario.assumptions.feeCaptureMultiplier.toFixed(2)}×</td>
                    <td>{scenario.assumptions.fixedBurnMultiplier.toFixed(2)}×</td>
                    <td>{fmtUSD(scenario.cumulativeCashInflowUsd)}</td>
                    <td>{fmtUSD(scenario.cumulativeNetCashUsd)}</td>
                    <td>{fmtUSD(scenario.endingCashUsd)}</td>
                    <td>{scenario.firstCashOutWeek ? `Week ${scenario.firstCashOutWeek}` : 'No breach in horizon'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="adm-section__head">
            <div>
              <h3 className="adm-section__title" style={{ fontSize: '1rem' }}>Payment-cycle intelligence</h3>
              <span className="adm-section__meta">Collections and renewal risk from existing billing + audit trails.</span>
            </div>
          </div>
          <div className="adm-stats" style={{ marginBottom: 24 }}>
            <div className="adm-stat"><div className="adm-stat__label">Recurring crypto active</div><div className="adm-stat__value">{data.paymentCycles.recurringActive}</div></div>
            <div className="adm-stat"><div className="adm-stat__label">Overdue recurring charges</div><div className="adm-stat__value">{data.paymentCycles.recurringOverdue}</div></div>
            <div className="adm-stat"><div className="adm-stat__label">Due next 7 days</div><div className="adm-stat__value">{data.paymentCycles.recurringDue7d}</div></div>
            <div className="adm-stat"><div className="adm-stat__label">Paid plans expiring 30d</div><div className="adm-stat__value">{data.paymentCycles.humanSubscriptionsExpiring30d}</div></div>
          </div>

          <div className="adm-section__head">
            <div>
              <h3 className="adm-section__title" style={{ fontSize: '1rem' }}>Process mining: quote → route → execute → settle</h3>
              <span className="adm-section__meta">Observed workflow bottlenecks, not a diagram of the intended process.</span>
            </div>
          </div>
          <div className="adm-table-wrap" style={{ marginBottom: 24 }}>
            <table className="adm-table">
              <thead><tr><th>Signal</th><th>Observed value</th><th>Why it matters</th></tr></thead>
              <tbody>
                <tr><td>Quotes observed</td><td>{data.execution.quotes.toLocaleString()}</td><td>Top of the measured routing funnel</td></tr>
                <tr><td>Quote → execution</td><td>{fmtPct(data.processMining.quoteToExecutionRate)}</td><td>Drop-off before economic action</td></tr>
                <tr><td>Avg route candidates / quote</td><td>{data.processMining.avgRouteCandidatesPerQuote?.toFixed(2) ?? '—'}</td><td>Routing choice depth</td></tr>
                <tr><td>Settlement latency</td><td>p50 {fmtSeconds(data.processMining.settlementLatencyP50Seconds)} / p95 {fmtSeconds(data.processMining.settlementLatencyP95Seconds)}</td><td>Tail latency drives support and capital lockup</td></tr>
              </tbody>
            </table>
          </div>

          <div className="adm-table-wrap" style={{ marginBottom: 24 }}>
            <table className="adm-table">
              <thead><tr><th>Top failure signature</th><th>Provider</th><th>Count</th></tr></thead>
              <tbody>
                {data.processMining.topFailureReasons.length === 0 ? (
                  <tr><td colSpan={3}>No failed-swap signatures in this window.</td></tr>
                ) : data.processMining.topFailureReasons.map((row, i) => (
                  <tr key={`${row.provider}-${i}`}>
                    <td><span className="adm-mono">{row.error}</span></td>
                    <td>{row.provider}</td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="adm-section__head">
            <div>
              <h3 className="adm-section__title" style={{ fontSize: '1rem' }}>Provider economics & resilience</h3>
              <span className="adm-section__meta">A digital-infrastructure analogue of supply-chain concentration.</span>
            </div>
          </div>
          <div className="adm-table-wrap" style={{ marginBottom: 24 }}>
            <table className="adm-table">
              <thead>
                <tr><th>Provider</th><th>Swaps</th><th>Success</th><th>Volume</th><th>Volume share</th><th>Measured price improvement</th></tr>
              </thead>
              <tbody>
                {data.providers.length === 0 ? (
                  <tr><td colSpan={6}>No provider execution data in this window.</td></tr>
                ) : data.providers.map((provider) => {
                  const share = data.resilience.providerConcentration.totalVolumeUsd > 0
                    ? provider.volumeUsd / data.resilience.providerConcentration.totalVolumeUsd
                    : null;
                  return (
                    <tr key={provider.provider}>
                      <td><span className="adm-mono">{provider.provider}</span></td>
                      <td>{provider.total.toLocaleString()}</td>
                      <td>{fmtPct(provider.successRate)}</td>
                      <td>{fmtUSD(provider.volumeUsd)}</td>
                      <td>{fmtPct(share)}</td>
                      <td>{fmtUSD(provider.priceImprovementUsd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="adm-error" style={{ borderColor: 'rgba(245, 158, 11, 0.28)', color: 'var(--adm-faint)' }}>
            <strong style={{ color: 'var(--adm-text)' }}>Still missing before this becomes an authoritative finance ledger:</strong>
            <ul style={{ margin: '8px 0 8px 18px', padding: 0 }}>
              {data.dataQuality.missing.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <div style={{ marginTop: 8 }}>The operating system intentionally distinguishes cash receipts, accrued fees, execution economics, and recognized revenue.</div>
          </div>
        </>
      )}
    </div>
  );
}
