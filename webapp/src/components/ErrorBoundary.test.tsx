import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ErrorBoundary } from './ErrorBoundary'

// Suppress React error boundary console noise during tests
let consoleErrorSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  document.body.innerHTML = ''
})

/** Helper component that throws on render */
function ThrowingComponent() {
  throw new Error('Test error')
  return null
}

function renderInto(element: React.ReactNode): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return container
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error', () => {
    const container = renderInto(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>
    )

    expect(container.textContent).toContain('Hello')
  })

  it('catches error and shows fallback UI with error message', () => {
    const container = renderInto(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )

    expect(container.textContent).toContain('Something went wrong')
    expect(container.textContent).toContain('Retry')
  })

  it('logs error via console.error in componentDidCatch', () => {
    renderInto(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )

    const calls = consoleErrorSpy.mock.calls
    const didCatchCall = calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'string' && args[0].includes('[ErrorBoundary]')
    )
    expect(didCatchCall).toBeTruthy()
  })

  it('renders custom fallback when provided', () => {
    const container = renderInto(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    )

    expect(container.textContent).toContain('Custom fallback')
    expect(container.textContent).not.toContain('Something went wrong')
  })

  it('resets error state when Try Again is clicked', () => {
    let shouldThrow = true

    function ConditionalThrower() {
      if (shouldThrow) {
        throw new Error('Conditional error')
      }
      return <div>Recovered</div>
    }

    const container = renderInto(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>
    )

    expect(container.textContent).toContain('Something went wrong')

    // Stop throwing before retry
    shouldThrow = false

    const buttons = container.getElementsByTagName('button')
    const retryButton = Array.from(buttons).find((btn) => btn.textContent === 'Retry')
    expect(retryButton).toBeTruthy()

    act(() => {
      retryButton!.click()
    })

    expect(container.textContent).toContain('Recovered')
  })
})
