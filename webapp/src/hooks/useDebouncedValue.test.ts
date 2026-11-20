import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('1.0', 200))
    expect(result.current).toBe('1.0')
  })

  it('debounces rapid changes — only the final value lands', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 200),
      { initialProps: { v: '1.0' } }
    )

    // Rapid typing: values change faster than the debounce window
    rerender({ v: '1.5' })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ v: '1.55' })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ v: '1.555' })

    // Still the old value — debounce hasn't fired
    expect(result.current).toBe('1.0')

    // Let the debounce window expire
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('1.555')
  })

  it('fires within 200ms of the user pausing — casino-grade, not 500ms', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 200),
      { initialProps: { v: '1.0' } }
    )

    rerender({ v: '2.0' })
    // At 200ms the new value must already be live (old code waited 500ms+)
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('2.0')
  })
})
