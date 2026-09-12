'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/links';

interface FinanceScenario {
  name: 'survival' | 'base' | 'growth';
  inflowMultiplier: number;
  weeklyCashInflowUsd: number;
  weeklyNetCashUsd: number | null;
  endingCashUsd: number | null;
  runwayWeeks: number | null;
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
    trackedGasCostUsd: number;
    trackedFeeCostUsd: number;
    priceImprovementUsd: number;
    avgPriceImprovementUsd: number;
    apiCalls: number;
  };
  providers: FinanceProvider[];
  planning: {
    startingCashUsd: number | null;
    weeklyOperatingBurnUsd: number | null;
    forecast: FinanceScenario[];
  };
  dataQuality: {
    complete: boolean;
    missing: string[];
    notes: string[];
  };
}

const CASH_KEY = 'suwappu_finance_cash_usd';
const BURN_KEY = 'suwappu_finance_weekly_burn_usd';

function fmtUSD(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function numericInput(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export default function FinancePanel({ apiKey }: { apiKey: string }) {
  const [cash, setCash] = useState('');
  const [burn, setBurn] = useState('');
  const [data, setData] = useState<FinanceResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setCash(localStorage.getItem(CASH_KEY) ?? '');
    setBurn(localStorage.getItem(BURN_KEY) ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    const params = new URLSearchParams();
    const cashValue = numericInput(cash);
    const burnValue = numericInput(burn);
    if (cashValue !== null) params.set('cash_usd', String(cashValue));
    if (burnValue !== null) params.set('weekly_burn_usd', String(burnValue));

    try {
      const suffix = params.size ? `?${params.toString()}` : '';
      const res = await fetch(`${API_BASE_URL}/admin/finance${suffix}`, {
        headers: { 'X-Admin-Key': apiKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as FinanceResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load finance control plane');
    } finally {
      setLoading(false);
    }
  }, [apiKey, cash, burn]);

  useEffect(() => {
    void load();
    // Planning values are loaded from localStorage just after mount; a second fetch with
    // those values is intentional and keeps them out of server-side persistence.
  }, [load]);

  function savePlanningInputs() {
    const cashValue = numericInput(cash);
    const burnValue = numericInput(burn);

    if (cash.trim() && cashValue === null) {
      setError('Starting cash must be a non-negative USD value.');
      return;
    }
    if (burn.trim() && burnValue === null) {
      setError('Weekly burn must be a non-negative USD value.');
      return;
    }

    if (cashValue === null) localStorage.removeItem(CASH_KEY);
    else localStorage.setItem(CASH_KEY, String(cashValue));

    if (burnValue === null) localStorage.removeItem(BURN_KEY);
    else localStorage.setItem(BURN_KEY, String(burnValue));

    void load();
  }

  return (
    <div className="adm-section" id="finance" style={{ scrollMarginTop: 24 }}>
      <div className="adm-section__head">
        <div>
          <h2 className="adm-section__title">CFO Control Plane</h2>
          <span className="adm-section__meta">30-day operating view + 13-week scenarios</span>
        </div>
        <button className="adm-export-btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="adm-error">Finance view unavailable: {error}</div>}
      {!data && loading && <div className="adm-loading">Loading finance control plane…</div>}

      {data && (
        <>
          <div className="adm-stats">
            <div className="adm-stat">
              <div className="adm-stat__label">Tracked cash inflow · 30d</div>
              <div className="adm-stat__value">{fmtUSD(data.cashInflow.tracked30dUsd)}</div>
              <div className="adm-stat__sub">{fmtUSD(data.cashInflow.weeklyRunRateUsd)} weekly run-rate</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Swap volume · 30d</div>
              <div className="adm-stat__value">{fmtUSD(data.execution.volumeUsd)}</div>
              <div className="adm-stat__sub">{data.execution.totalSwaps.toLocaleString()} swaps</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Execution success</div>
              <div className="adm-stat__value">{fmtPct(data.execution.successRate)}</div>
              <div className="adm-stat__sub">
                {data.execution.completedSwaps.toLocaleString()} completed / {data.execution.failedSwaps.toLocaleString()} failed
              </div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Quote → execution</div>
              <div className="adm-stat__value">{fmtPct(data.execution.quoteToExecutionRate)}</div>
              <div className="adm-stat__sub">
                {data.execution.quotesWithExecution.toLocaleString()} of {data.execution.quotes.toLocaleString()} observed quotes
              </div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Fee capture</div>
              <div className="adm-stat__value">
                {data.unitEconomics.feeCaptureBps === null ? '—' : `${data.unitEconomics.feeCaptureBps.toFixed(1)} bps`}
              </div>
              <div className="adm-stat__sub">{fmtUSD(data.cashInflow.sources.swapFeesAccruedUsd)} accrued</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Price improvement · 30d</div>
              <div className="adm-stat__value">{fmtUSD(data.unitEconomics.priceImprovementUsd)}</div>
              <div className="adm-stat__sub">{fmtUSD(data.unitEconomics.avgPriceImprovementUsd)} avg measured edge</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">API calls · 30d</div>
              <div className="adm-stat__value">{data.unitEconomics.apiCalls.toLocaleString()}</div>
              <div className="adm-stat__sub">enterprise usage events</div>
            </div>
            <div className="adm-stat">
              <div className="adm-stat__label">Cash inflow / completed swap</div>
              <div className="adm-stat__value">{fmtUSD(data.unitEconomics.trackedCashInflowPerCompletedSwapUsd)}</div>
              <div className="adm-stat__sub">directional proxy, not GAAP revenue</div>
            </div>
          </div>

          <div className="adm-section__head" style={{ marginTop: 24 }}>
            <div>
              <h3 className="adm-section__title" style={{ fontSize: '1rem' }}>13-week cash planning</h3>
              <span className="adm-section__meta">Inputs stay in this browser; the API does not persist them.</span>
            </div>
          </div>

          <div className="adm-stats" style={{ marginBottom: 14 }}>
            <div className="adm-stat">
              <label className="adm-stat__label" htmlFor="finance-cash">Starting cash (USD)</label>
              <input
                id="finance-cash"
                className="adm-auth__input"
                inputMode="decimal"
                placeholder="e.g. 50000"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
              />
            </div>
            <div className="adm-stat">
              <label className="adm-stat__label" htmlFor="finance-burn">Weekly operating burn (USD)</label>
              <input
                id="finance-burn"
                className="adm-auth__input"
                inputMode="decimal"
                placeholder="e.g. 3000"
                value={burn}
                onChange={(e) => setBurn(e.target.value)}
              />
            </div>
            <div className="adm-stat" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
              <button className="adm-auth__btn" onClick={savePlanningInputs} style={{ marginTop: 12 }}>
                Apply planning inputs
              </button>
            </div>
          </div>

          <div className="adm-table-wrap" style={{ marginBottom: 20 }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Inflow assumption</th>
                  <th>Weekly inflow</th>
                  <th>Weekly net cash</th>
                  <th>13-week ending cash</th>
                  <th>Runway</th>
                </tr>
              </thead>
              <tbody>
                {data.planning.forecast.map((scenario) => (
                  <tr key={scenario.name}>
                    <td><strong>{scenario.name.charAt(0).toUpperCase() + scenario.name.slice(1)}</strong></td>
                    <td>{scenario.inflowMultiplier.toFixed(1)}× trailing run-rate</td>
                    <td>{fmtUSD(scenario.weeklyCashInflowUsd)}</td>
                    <td>{fmtUSD(scenario.weeklyNetCashUsd)}</td>
                    <td>{fmtUSD(scenario.endingCashUsd)}</td>
                    <td>{scenario.runwayWeeks === null ? '—' : `${scenario.runwayWeeks.toFixed(1)} weeks`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="adm-section__head">
            <div>
              <h3 className="adm-section__title" style={{ fontSize: '1rem' }}>Provider economics</h3>
              <span className="adm-section__meta">Execution outcomes by selected route provider</span>
            </div>
          </div>
          <div className="adm-table-wrap" style={{ marginBottom: 20 }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Swaps</th>
                  <th>Success</th>
                  <th>Volume</th>
                  <th>Measured price improvement</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.length === 0 ? (
                  <tr><td colSpan={5}>No provider execution data in this window.</td></tr>
                ) : data.providers.map((provider) => (
                  <tr key={provider.provider}>
                    <td><span className="adm-mono">{provider.provider}</span></td>
                    <td>{provider.total.toLocaleString()}</td>
                    <td>{fmtPct(provider.successRate)}</td>
                    <td>{fmtUSD(provider.volumeUsd)}</td>
                    <td>{fmtUSD(provider.priceImprovementUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="adm-error" style={{ borderColor: 'rgba(245, 158, 11, 0.28)', color: 'var(--adm-faint)' }}>
            <strong style={{ color: 'var(--adm-text)' }}>Coverage gaps before this is a true CFO ledger:</strong>
            <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
              {data.dataQuality.missing.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
