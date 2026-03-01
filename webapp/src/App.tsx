import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { TonConnectProvider } from './contexts/TonConnectContext'
import { useTelegram } from './hooks/useTelegram'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OnboardingModal, useOnboarding, defaultOnboardingSteps } from './components/ui'
import './theme/suwappu.css'

// Eagerly load Welcome and Home (critical path)
import { Welcome, Home } from './pages'

// Lazy load all other pages for code splitting
const Swap = lazy(() => import('./pages/Swap').then(m => ({ default: m.Swap })))
const Wallet = lazy(() => import('./pages/Wallet').then(m => ({ default: m.Wallet })))
const Portfolio = lazy(() => import('./pages/Portfolio').then(m => ({ default: m.Portfolio })))
const History = lazy(() => import('./pages/History').then(m => ({ default: m.History })))
const Points = lazy(() => import('./pages/Points').then(m => ({ default: m.Points })))
const LimitOrders = lazy(() => import('./pages/LimitOrders').then(m => ({ default: m.LimitOrders })))
const PriceAlerts = lazy(() => import('./pages/PriceAlerts').then(m => ({ default: m.PriceAlerts })))
const Referrals = lazy(() => import('./pages/Referrals').then(m => ({ default: m.Referrals })))
const CopyTrading = lazy(() => import('./pages/CopyTrading').then(m => ({ default: m.CopyTrading })))
const Subscriptions = lazy(() => import('./pages/Subscriptions').then(m => ({ default: m.Subscriptions })))
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })))

// Loading fallback for lazy-loaded pages
function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-suwappu-bg">
      <div className="animate-pulse text-suwappu-text-secondary">Loading...</div>
    </div>
  )
}

// Page wrapper with CSS animation and Suspense for lazy components
function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageLoading />}>
      <div className="h-full animate-page-enter">
        {children}
      </div>
    </Suspense>
  )
}

// Create React Query client with aggressive caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data considered fresh for 10s, then background refetch
      staleTime: 10 * 1000,
      // Keep unused data in cache for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Refetch when window regains focus
      refetchOnWindowFocus: true,
      // Refetch when network reconnects
      refetchOnReconnect: true,
      // Retry failed requests twice (not 3x to fail faster)
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      // Don't throw errors - let components handle them
      throwOnError: false,
    },
    mutations: {
      // Retry mutations once on failure
      retry: 1,
      throwOnError: false,
    },
  },
})

// Protected route wrapper - redirects to welcome if not authenticated
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-suwappu-bg">
        <div className="animate-pulse text-suwappu-text-secondary">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location }} replace />
  }

  return <>{children}</>
}

// Public route - redirects to home if already authenticated
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-suwappu-bg">
        <div className="animate-pulse text-suwappu-text-secondary">Loading...</div>
      </div>
    )
  }

  if (isAuthenticated) {
    // Redirect to the page they were trying to visit, or home
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/home'
    return <Navigate to={from} replace />
  }

  return <>{children}</>
}

// Onboarding wrapper - shows guided tour for first-time users
function OnboardingWrapper({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const { isOpen, completeOnboarding, steps } = useOnboarding({
    steps: defaultOnboardingSteps,
    autoShow: true,
  })

  // Only show onboarding for authenticated users
  if (!isAuthenticated) {
    return <>{children}</>
  }

  return (
    <>
      {children}
      <OnboardingModal
        isOpen={isOpen}
        steps={steps}
        onComplete={completeOnboarding}
        onSkip={completeOnboarding}
      />
    </>
  )
}

// App content with Telegram integration
function AppContent() {
  const { webApp, colorScheme } = useTelegram()

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

  const location = useLocation()

  return (
    <OnboardingWrapper>
      <Routes location={location} key={location.pathname}>
        {/* Public routes */}
        <Route
          path="/"
          element={
            <PublicRoute>
              <PageTransition>
                <Welcome />
              </PageTransition>
            </PublicRoute>
          }
        />

        {/* Protected routes */}
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <PageTransition>
                <Home />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/swap"
          element={
            <ProtectedRoute>
              <PageTransition>
                <Swap />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/wallet/*"
          element={
            <ProtectedRoute>
              <PageTransition>
                <Wallet />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/portfolio"
          element={
            <ProtectedRoute>
              <PageTransition>
                <Portfolio />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <PageTransition>
                <History />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/points"
          element={
            <ProtectedRoute>
              <PageTransition>
                <Points />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/limit-orders"
          element={
            <ProtectedRoute>
              <PageTransition>
                <LimitOrders />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/alerts"
          element={
            <ProtectedRoute>
              <PageTransition>
                <PriceAlerts />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/referrals"
          element={
            <ProtectedRoute>
              <PageTransition>
                <Referrals />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/copy"
          element={
            <ProtectedRoute>
              <PageTransition>
                <CopyTrading />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/premium"
          element={
            <ProtectedRoute>
              <PageTransition>
                <Subscriptions />
              </PageTransition>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/*"
          element={
            <ProtectedRoute>
              <PageTransition>
                <Settings />
              </PageTransition>
            </ProtectedRoute>
          }
        />

        {/* Fallback redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </OnboardingWrapper>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TonConnectProvider>
          <AuthProvider>
            <BrowserRouter>
              <AppContent />
            </BrowserRouter>
          </AuthProvider>
        </TonConnectProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
