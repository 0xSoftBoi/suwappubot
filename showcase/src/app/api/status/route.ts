// Server-side health checks (avoids browser CORS). Polled by /status.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENDPOINTS = [
  { id: 'api', label: 'Production API', url: 'https://api.suwappu.bot/health' },
  { id: 'devapi', label: 'Development API', url: 'https://devapi.suwappu.bot/health' },
];

async function check(url: string): Promise<{ ok: boolean; status: number; ms: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  const started = Date.now();
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    return { ok: r.ok, status: r.status, ms: Date.now() - started };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const services = await Promise.all(
    ENDPOINTS.map(async (e) => ({ ...e, ...(await check(e.url)) })),
  );
  const allUp = services.every((s) => s.ok);
  return Response.json(
    { checkedAt: new Date().toISOString(), allUp, services },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
