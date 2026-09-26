import { NextRequest, NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/links';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SIGNAL_LAB_URL = process.env.SIGNAL_LAB_URL || 'https://signal-lab-dev.up.railway.app';

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const cookie = request.headers.get('cookie') || '';
  const authorization = request.headers.get('authorization') || '';
  if (!cookie && !authorization) return false;

  try {
    const response = await fetch(`${API_BASE_URL}/enterprise/orgs/me`, {
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(authorization ? { authorization } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return response.status !== 401 && response.status !== 403;
  } catch {
    return false;
  }
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
