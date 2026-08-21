import { afterEach, describe, expect, it, mock } from 'bun:test'
import React, { type ReactNode } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'

mock.module('../contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({ isAuthenticated: false, isLoading: false }),
  formatAddress: (address: string) => address,
}))

mock.module('../hooks/useTelegram', () => ({
  useTelegram: () => ({ webApp: null, colorScheme: 'light' }),
}))

mock.module('../hooks/useDesktopHotkeys', () => ({
  useDesktopHotkeys: () => undefined,
}))

mock.module('../pages/Discover', () => ({
  default: () => <div>PUBLIC_DISCOVER_SENTINEL</div>,
}))

let root: Root | null = null

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  document.body.innerHTML = ''
  window.location.href = 'https://app.suwappu.bot/'
})

describe('public app routing', () => {
  it('keeps a signed-out visitor on /discover', async () => {
    window.location.href = 'https://app.suwappu.bot/discover'
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const { default: App } = await import('../App')

    await act(async () => {
      root?.render(<App />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(window.location.pathname).toBe('/discover')
    expect(container.textContent).toContain('PUBLIC_DISCOVER_SENTINEL')
  })
})
