import { useState, useEffect } from 'react'

// Width alone misclassifies modern phones in landscape (often 780–930px wide)
// as the dense three-pane desktop terminal. Coarse-pointer + short-height catches
// those devices without collapsing ordinary small desktop windows into mobile UI.
const MOBILE_QUERY =
  '(max-width: 767px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)'

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
