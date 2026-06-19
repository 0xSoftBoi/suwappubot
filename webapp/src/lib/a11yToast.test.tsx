/**
 * End-to-end render test: drives a11yToast through the REAL react-hot-toast
 * <Toaster> and asserts the accessibility contract in a live DOM.
 *
 * Mirrors ErrorBoundary.test.tsx's proven pattern for this repo's bun + happy-dom
 * setup: createRoot + react-dom/test-utils act, and getElementsByTagName/textContent
 * for queries (happy-dom's attribute-selector querySelector throws here).
 */
import { describe, it, expect, afterEach, beforeAll } from 'bun:test'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import toast, { Toaster } from 'react-hot-toast'
import a11yToast from './a11yToast'

// react-hot-toast's store is module-global. Track roots so each test fully
// unmounts and purges, otherwise an Infinity-duration error toast leaks into
// the next test (and stacked subscribed roots hang the run).
const roots: Root[] = []

beforeAll(() => {
  // @ts-ignore - tell React this is a valid act() environment.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // react-hot-toast reads a bare global matchMedia (reduced-motion) and uses
  // MutationObserver/ResizeObserver for height measurement; happy-dom doesn't
  // expose them globally. Shim them — we assert semantics, not layout.
  const mm = (q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })
  class NoopObserver {
    observe() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  // @ts-ignore
  globalThis.matchMedia ||= mm
  // @ts-ignore
  globalThis.MutationObserver ||= NoopObserver
  // @ts-ignore
  globalThis.ResizeObserver ||= NoopObserver
})

afterEach(() => {
  act(() => {
    toast.remove() // hard-purge the global store (no lingering exit timers)
  })
  act(() => {
    while (roots.length) roots.pop()!.unmount()
  })
  document.body.innerHTML = ''
})

function renderToaster(): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(React.createElement(Toaster))
  })
  return container
}

/** Poll the live DOM until predicate is true (toasts render asynchronously). */
async function until(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 15))
  }
}

/** Find a descendant by role/aria-label WITHOUT querySelector (happy-dom safe). */
function findByAttr(root: ParentNode, attr: string, value: string): Element | null {
  const els = root.getElementsByTagName('*')
  for (const el of els) {
    if (el.getAttribute && el.getAttribute(attr) === value) return el
  }
  return null
}
const byRole = (r: string) => findByAttr(document.body, 'role', r)

describe('a11yToast — live render through react-hot-toast', () => {
  it('renders an ERROR as role="alert", with word + plain language + close button', async () => {
    renderToaster()
    act(() => {
      // "slippage" must be translated to plain language in the rendered copy.
      a11yToast.error('slippage exceeded')
    })

    // role="alert" => assertive live region (screen readers interrupt).
    await until(() => byRole('alert') !== null)
    const alert = byRole('alert')!
    expect(alert).toBeTruthy()

    // Severity word present (never color alone, WCAG 1.4.1).
    expect(alert.textContent).toContain('Failed')

    // Plain language applied: "slippage" -> "price moved since your quote".
    expect(alert.textContent).toContain('price moved since your quote')
    expect(alert.textContent).not.toContain('slippage')

    // A real, labelled close button exists for tremor / low-vision users.
    expect(findByAttr(document.body, 'aria-label', 'Dismiss notification')).toBeTruthy()
  })

  it('does NOT auto-dismiss an error before it can be read (persistent)', async () => {
    renderToaster()
    act(() => {
      a11yToast.error('network fee too low')
    })

    await until(() => byRole('alert') !== null)

    // Wait well past any normal toast auto-dismiss window; error must remain.
    await new Promise((r) => setTimeout(r, 350))
    expect(byRole('alert')).toBeTruthy()
  })

  it('renders SUCCESS politely (role="status"), not as an interrupting alert', async () => {
    renderToaster()
    act(() => {
      a11yToast.success('Order created')
    })

    await until(() => byRole('status') !== null)
    const status = byRole('status')!
    expect(status.textContent).toContain('Done')
    expect(status.textContent).toContain('Order created')
    // The success node itself must be polite, never an interrupting alert.
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
  })
})
