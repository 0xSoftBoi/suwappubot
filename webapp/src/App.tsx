import { useEffect, useMemo } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useTelegram } from './hooks/useTelegram'
import { createAppRouter } from './router'
import './theme/suwappu.css'

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 seconds
      retry: 2,
    },
  },
})

// Inner app with router - needs auth context
function AppWithRouter() {
  const { isAuthenticated, isLoading } = useAuth()
  const { webApp, colorScheme } = useTelegram()

  // Create router with context
  const router = useMemo(
    () =>
      createAppRouter({
        queryClient,
        auth: { isAuthenticated, isLoading },
      }),
    [isAuthenticated, isLoading]
  )

  useEffect(() => {
    // Sync theme with Telegram or default to light
    if (colorScheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [colorScheme])

  useEffect(() => {
    // Expand the webapp to full height if in Telegram
    if (webApp) {
      webApp.expand()
      webApp.ready()
    }
  }, [webApp])

  return <RouterProvider router={router} />
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppWithRouter />
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
