import { API_BASE_URL } from '@/lib/links';
import { isRunnable } from './allowlist';
import { refreshBalance } from './keyStore';

export type CallResult = {
  ok: boolean;
  status: number;        // 0 = network failure
  ms: number;
  data: unknown;
  error: string | null;  // real upstream message, or a network note
};

const msg = (data: unknown): string | null => {
  const d = data as { error?: unknown; message?: unknown; hint?: unknown } | null;
  const eo = d?.error as { message?: unknown } | null | undefined;
  const e = typeof d?.error === 'string' ? d.error : typeof eo?.message === 'string' ? eo.message : typeof d?.message === 'string' ? d.message : null;
  return e ? (typeof d?.hint === 'string' ? `${e} (${d.hint})` : e) : null;
};

/**
 * The only fetch the product widgets use. Refuses anything off the allowlist,
 * sends the key only as Authorization to the Suwappu API, never in a URL.
 */
export async function callApi(opts: {
  method?: 'GET' | 'POST'; path: string; body?: unknown; key?: string | null; headers?: Record<string, string>; refresh?: boolean;
}): Promise<CallResult> {
  const method = opts.method ?? 'GET';
  if (!isRunnable(method, opts.path)) throw new Error(`Blocked: ${method} ${opts.path} is not runnable from the site.`);
  // /mcp is read-only from the site: only discovery calls, never tools/call (which can move funds).
  if (opts.path.split('?')[0] === '/mcp') {
    const m = (opts.body as { method?: unknown } | undefined)?.method;
    if (m !== 'tools/list' && m !== 'initialize') throw new Error('Blocked: only tools/list and initialize may be sent to /mcp from the site.');
  }
  const t0 = performance.now();
  try {
    const res = await fetch(`${API_BASE_URL}${opts.path}`, {
      method,
      credentials: 'omit',
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch {
      // MCP may answer as an event stream: take the last `data:` frame.
      const frame = text.split('\n').filter((l) => l.startsWith('data:')).pop();
      try { data = frame ? JSON.parse(frame.slice(5)) : text.slice(0, 2000); } catch { data = text.slice(0, 2000); }
    }
    if (opts.key && opts.refresh !== false && opts.path !== '/v1/agent/billing') void refreshBalance();
    return {
      ok: res.ok, status: res.status, ms: Math.round(performance.now() - t0), data,
      error: res.ok ? null : msg(data) ?? `HTTP ${res.status}`,
    };
  } catch {
    return { ok: false, status: 0, ms: Math.round(performance.now() - t0), data: null, error: 'Could not reach api.suwappu.bot from this browser (network or CORS).' };
  }
}
