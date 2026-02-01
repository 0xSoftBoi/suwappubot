import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from '../api/client'
import type { StatsResponse } from '../api/types'

const KEY = 'suwappu_admin_key'

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const validate = useCallback(async () => {
    const key = localStorage.getItem(KEY)
    if (!key) {
      setIsAuthenticated(false)
      setIsLoading(false)
      return
    }

    try {
      await adminFetch<StatsResponse>('/admin/stats')
      setIsAuthenticated(true)
    } catch {
      localStorage.removeItem(KEY)
      setIsAuthenticated(false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    validate()
  }, [validate])

  const login = useCallback(async (key: string) => {
    localStorage.setItem(KEY, key)
    try {
      await adminFetch<StatsResponse>('/admin/stats')
      setIsAuthenticated(true)
      return true
    } catch {
      localStorage.removeItem(KEY)
      setIsAuthenticated(false)
      return false
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(KEY)
    setIsAuthenticated(false)
  }, [])

  return { isAuthenticated, isLoading, login, logout }
}
