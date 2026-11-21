'use client';

import { useEffect, useState, useCallback } from 'react';
import '../content-v3.css';

type Service = { id: string; label: string; url: string; ok: boolean; status: number; ms: number };
type StatusData = { checkedAt: string; allUp: boolean; services: Service[] };

/**
 * Live health-check board. Polls the server-side /api/status route (avoids
 * browser CORS) every 30s. Only surfaces we can actually reach over HTTP -
 * the production and development API get a live dot. The static "Surfaces"
 * section lists MCP/A2A/bot/terminal without inheriting API health for them.
 */
export default function StatusBoard() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const banner = error
    ? { cls: 'is-unknown', text: 'Unable to reach status checks' }
    : loading && !data
      ? { cls: 'is-unknown', text: 'Checking services…' }
      : data?.allUp
        ? { cls: 'is-up', text: 'All monitored API origins operational' }
        : { cls: 'is-down', text: 'A monitored API origin is degraded' };

  const state = error ? 'unknown' : loading && !data ? 'unknown' : data?.allUp ? 'up' : 'down';
  const hasData = !!data && !error;
  const total = hasData ? data.services.length : 0;
  const up = hasData ? data.services.filter((sv) => sv.ok).length : 0;
  const frac = total ? up / total : 0;

  return (
    <div className={`cv3-gauge-wrap is-${state}`}>
      <div className="cv3-gauge" role="status" aria-live="polite">
        <svg viewBox="0 0 120 120" className="cv3-gauge__ring" aria-hidden="true" focusable="false">
          <circle cx="60" cy="60" r="52" className="cv3-gauge__track" />
          <circle cx="60" cy="60" r="52" className="cv3-gauge__arc" pathLength={100}
            style={hasData ? { strokeDasharray: `${Math.max(frac * 100, 2)} 100` } : undefined} />
          <circle cx="60" cy="60" r="40" className="cv3-gauge__inner" />
          <text x="60" y="64" textAnchor="middle" className="cv3-gauge__n">{hasData ? `${up}/${total}` : '—'}</text>
          <text x="60" y="82" textAnchor="middle" className="cv3-gauge__l">ORIGINS UP</text>
        </svg>
        <div className="cv3-gauge__text">
          <strong>{banner.text}</strong>
          <button type="button" className="cv3-gauge__btn" onClick={load} disabled={loading}>
            {loading ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="cv3-instr">
        {hasData
          ? data.services.map((sv) => (
              <div key={sv.id} className={`cv3-instr__row ${sv.ok ? 'is-up' : 'is-down'}`}>
                <span className="cv3-instr__dot" aria-hidden="true" />
                <div className="cv3-instr__main">
                  <strong>{sv.label}</strong>
                  <span>{sv.url}</span>
                </div>
                <div className="cv3-instr__read">
                  <span className="sw-nums">
                    {sv.ok ? `${sv.status} · ${sv.ms}ms` : sv.status ? `HTTP ${sv.status}` : 'unreachable'}
                  </span>
                  {sv.ok && <i className="cv3-instr__bar" aria-hidden="true"><b style={{ transform: `scaleX(${Math.min(Math.max(sv.ms / 1000, 0.04), 1)})` }} /></i>}
                </div>
              </div>
            ))
          : [0, 1].map((n) => (
              <div key={n} className="cv3-instr__row is-idle" aria-hidden="true">
                <span className="cv3-instr__dot" />
                <div className="cv3-instr__main"><b className="cv3-skel" /><b className="cv3-skel cv3-skel--s" /></div>
              </div>
            ))}
      </div>

      {data?.checkedAt && !error && (
        <p className="cv3-checked">
          Last checked {new Date(data.checkedAt).toLocaleTimeString()} · auto-refreshes every 30s
        </p>
      )}
    </div>
  );
}
