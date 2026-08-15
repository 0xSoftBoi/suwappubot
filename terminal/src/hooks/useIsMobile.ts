import { useState, useEffect } from 'react'

// The desktop desk has three panes whose minimum widths already add up to ~840px,
// before gutters. Keep narrow tablets/windows on the usable single-pane layout,
// and also catch wide landscape phones via coarse-pointer + short-height.
const MOBILE_QUERY =
  '(max-width: 900px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    setIsMobile(mql.matches)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return isMobile
}
