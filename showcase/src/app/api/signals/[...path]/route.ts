import { NextRequest, NextResponse } from 'next/server';
import { probeSession } from '@/app/dashboard/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SIGNAL_LAB_URL = process.env.SIGNAL_LAB_URL || 'https://signal-lab-dev.up.railway.app';

/**
 * Signed in is enough to read signals.
 *
 * This gate previously required an *enterprise-tier* answer from
 * `/enterprise/orgs/me` and treated 403 as unauthenticated — so a perfectly
 * valid Google session got a 401 on every panel of the Signal Intelligence
 * page and the UI told the user their session had expired. It had not. See
 * probeSession.
 */
async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const cookie = request.headers.get('cookie') || '';
  const authorization = request.headers.get('authorization') || '';
  if (!cookie && !authorization) return false;

  return probeSession({
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    },
    signal: AbortSignal.timeout(5000),
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
  }

  const { path } = await context.params;
  const clean = (path || []).map((part) => encodeURIComponent(decodeURIComponent(part))).join('/');
  const upstream = new URL(`${SIGNAL_LAB_URL.replace(/\/$/, '')}/api/${clean}`);
  request.nextUrl.searchParams.forEach((value, key) => upstream.searchParams.append(key, value));

  try {
    const response = await fetch(upstream, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json',
        'cache-control': 'private, no-store',
        'x-suwappu-data-source': 'onchain-signal-lab',
      },
    });
  } catch {
    return NextResponse.json(
      { detail: 'Signal data service is temporarily unavailable' },
      { status: 503, headers: { 'cache-control': 'private, no-store' } },
    );
  }
}
