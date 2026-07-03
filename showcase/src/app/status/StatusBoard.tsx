'use client';

import { useEffect, useState, useCallback } from 'react';

type Service = { id: string; label: string; url: string; ok: boolean; status: number; ms: number };
type StatusData = { checkedAt: string; allUp: boolean; services: Service[] };

/**
 * Live health-check board. Polls the server-side /api/status route (avoids
 * browser CORS) every 30s. Only surfaces we can actually reach over HTTP —
 * the production and development API — get a live dot; see the static
 * "Surfaces" section on the page for MCP/A2A/bot/terminal, which share this
 * same backend rather than exposing their own health endpoints.
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
        ? { cls: 'is-up', text: 'All systems operational' }
        : { cls: 'is-down', text: 'Some systems are degraded' };

  return (
    <div className="status-live">
      <div className={`status-banner ${banner.cls}`}>
        <span className="status-dot" aria-hidden="true" />
        <strong>{banner.text}</strong>
        <button type="button" className="status-refresh" onClick={load} disabled={loading}>
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <div className="status-list">
        {(data?.services ?? []).map((s) => (
          <div key={s.id} className="status-row">
            <span className={`status-dot ${s.ok ? 'is-up' : 'is-down'}`} aria-hidden="true" />
            <div className="status-row__main">
              <strong>{s.label}</strong>
              <span className="status-row__url">{s.url}</span>
            </div>
            <span className="status-row__meta">
              {s.ok ? `${s.status} · ${s.ms}ms` : s.status ? `HTTP ${s.status}` : 'unreachable'}
            </span>
          </div>
        ))}
      </div>

      {data?.checkedAt && (
        <p className="status-checked">
          Last checked {new Date(data.checkedAt).toLocaleTimeString()} · auto-refreshes every 30s
        </p>
      )}
    </div>
  );
}
