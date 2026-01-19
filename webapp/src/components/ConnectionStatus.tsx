/**
 * Connection Status Component
 *
 * Shows API connection status in the app header.
 * Uses the health endpoint to determine connection state.
 */
import { useQuery } from '@tanstack/react-query'
import { useApi } from '../contexts/ApiContext'

type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'slow'

interface ConnectionStatusProps {
  /** Show label text next to indicator */
  showLabel?: boolean
  /** Size of the indicator dot */
  size?: 'sm' | 'md' | 'lg'
  /** Additional CSS classes */
  className?: string
}

/**
 * Displays a colored dot indicating API connection status.
 *
 * - Green: Connected and healthy
 * - Yellow: Connecting or slow response
 * - Red: Disconnected or error
 */
export function ConnectionStatus({
  showLabel = false,
  size = 'sm',
  className = '',
}: ConnectionStatusProps) {
  const api = useApi()

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth(),
    refetchInterval: 30000, // Check every 30 seconds
    refetchOnWindowFocus: true,
    retry: 2,
    staleTime: 10000, // Consider data fresh for 10 seconds
  })

  // Determine connection state
  let state: ConnectionState = 'disconnected'
  if (isLoading) {
    state = 'connecting'
  } else if (isError) {
    state = 'disconnected'
  } else if (data?.status === 'ok') {
    state = isFetching ? 'slow' : 'connected'
  } else if (data?.status === 'degraded') {
    state = 'slow'
  }

  // Get status styles
  const getStateStyles = (state: ConnectionState) => {
    switch (state) {
      case 'connected':
        return {
          dotColor: 'bg-suwappu-success',
          label: 'Connected',
          pulse: false,
        }
      case 'connecting':
        return {
          dotColor: 'bg-suwappu-warning',
          label: 'Connecting',
          pulse: true,
        }
      case 'slow':
        return {
          dotColor: 'bg-suwappu-warning',
          label: 'Slow',
          pulse: true,
        }
      case 'disconnected':
        return {
          dotColor: 'bg-suwappu-error',
          label: 'Disconnected',
          pulse: false,
        }
    }
  }

  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  }

  const styles = getStateStyles(state)

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="relative">
        <div
          className={`${sizeClasses[size]} rounded-full ${styles.dotColor} ${
            styles.pulse ? 'animate-pulse' : ''
          }`}
        />
        {styles.pulse && (
          <div
            className={`absolute inset-0 ${sizeClasses[size]} rounded-full ${styles.dotColor} opacity-50 animate-ping`}
          />
        )}
      </div>
      {showLabel && (
        <span className="text-xs text-suwappu-text-secondary font-heading">
          {styles.label}
        </span>
      )}
    </div>
  )
}

/**
 * Hook to get the current connection status for use in other components.
 */
export function useConnectionStatus() {
  const api = useApi()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth(),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    retry: 2,
    staleTime: 10000,
  })

  const isConnected = !isLoading && !isError && data?.status === 'ok'
  const isDegraded = data?.status === 'degraded'

  return {
    isConnected,
    isDegraded,
    isLoading,
    isError,
    status: data?.status,
    service: data?.service,
    refetch,
  }
}
