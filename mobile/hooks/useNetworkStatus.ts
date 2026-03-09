/**
 * Network connectivity hook using fetch-based polling.
 *
 * Pings the API health endpoint every 15 seconds.
 * No external dependencies required.
 */
import { useState, useEffect, useRef } from 'react'

const HEALTH_URL = process.env.EXPO_PUBLIC_API_URL
  ? `${process.env.EXPO_PUBLIC_API_URL}/health`
  : 'https://api.suwappu.bot/health'
const POLL_INTERVAL = 15_000

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const check = async () => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        await fetch(HEALTH_URL, { method: 'HEAD', signal: controller.signal })
        clearTimeout(timeout)
        setIsOnline(true)
      } catch {
        setIsOnline(false)
      }
    }

    check()
    intervalRef.current = setInterval(check, POLL_INTERVAL)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  return { isOnline, isOffline: !isOnline }
}
