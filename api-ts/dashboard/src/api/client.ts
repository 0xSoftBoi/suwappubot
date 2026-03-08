const API_BASE = ''

function getAdminKey(): string {
  return localStorage.getItem('suwappu_admin_key') || ''
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': getAdminKey(),
      ...init?.headers,
    },
  })

  if (res.status === 401) {
    localStorage.removeItem('suwappu_admin_key')
    window.location.href = '/dashboard/'
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(body.error || body.message || `HTTP ${res.status}`)
  }

  return res.json() as Promise<T>
}

export async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(body.error || body.message || `HTTP ${res.status}`)
  }

  return res.json() as Promise<T>
}
