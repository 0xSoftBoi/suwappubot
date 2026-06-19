import { getAuthToken } from './auth'
import type { MarginMode } from '../types/perps'

// Perps write-path client. Kept OUT of src/lib/api.ts so this UI work doesn't
// collide with other agents editing that file. The shared `request` helper there
// isn't exported, so we replicate its minimal fetch+auth pattern here.
//
// IMPORTANT: none of these routes exist on the backend yet. The UI gates every
// action behind "coming soon" (disabled + tooltip), so these functions are NOT
// wired to any live button — they're the drop-in target for when the routes
// land. `perpsRoutesAvailable()` is the single switch the UI reads to decide
// whether to ungate.

const BASE_URL = import.meta.env.VITE_API_URL || ''

// Flip to true once the backend routes below actually exist. Until then every
// perps write action stays honestly gated.
export function perpsRoutesAvailable(): boolean {
  return false
}

async function perpsRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  // Dev-mode header parity with src/lib/api.ts so local dev works once routes land.
  if (!token && typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    headers['X-Dev-User-Id'] = '12345'
  }

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, { credentials: 'include', ...options, headers })
  } catch {
    throw { detail: "Can't reach Suwappu right now. Check your connection and try again.", status: 0 }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw { detail: body.detail || body.message || res.statusText, status: res.status }
  }
  return res.json()
}

export interface SetTpSlParams {
  positionId: string
  takeProfitPrice?: number
  stopLossPrice?: number
  takeProfitPct?: number
  stopLossPct?: number
}

export const perpsApi = {
  // POST /webapp/me/perps/tpsl — attach take-profit / stop-loss to an open position.
  setTpSl(params: SetTpSlParams) {
    return perpsRequest<{ ok: boolean }>('/webapp/me/perps/tpsl', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  // POST /webapp/me/perps/margin-mode — set cross/isolated for a market.
  setMarginMode(market: string, mode: MarginMode) {
    return perpsRequest<{ ok: boolean }>('/webapp/me/perps/margin-mode', {
      method: 'POST',
      body: JSON.stringify({ market, mode }),
    })
  },
}
