import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useTelegram } from './hooks/useTelegram'
import { Welcome, Home, Swap, Wallet, Portfolio, History, Settings } from './pages'
import './theme/suwappu.css'

// Page transition variants
const pageVariants: Variants = {
  initial: {
    opacity: 0,
    x: 20,
  },
  enter: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.25,
      ease: [0.25, 0.46, 0.45, 0.94], // easeOutQuad
    },
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: {
      duration: 0.2,
      ease: [0.55, 0.06, 0.68, 0.19], // easeInQuad
    },
  },
}

// Page wrapper with animation
function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="enter"
      exit="exit"
      className="h-full"
    >
      {children}
    </motion.div>
  )
}

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 seconds
      retry: 2,
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
    <AnimatePresence mode="wait">
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
    </AnimatePresence>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
