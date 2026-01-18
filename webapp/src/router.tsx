import { createRouter, createRoute, createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { motion, type Variants } from 'framer-motion'
import { Welcome, Home, Swap, Wallet, Portfolio, Settings } from './pages'

// Router context type
interface RouterContext {
  queryClient: QueryClient
  auth: {
    isAuthenticated: boolean
    isLoading: boolean
  }
}

// Page transition variants
const pageVariants: Variants = {
  initial: { opacity: 0, x: 20 },
  enter: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.25, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: { duration: 0.2, ease: 'easeIn' },
  },
}

// Animated page wrapper
function PageWrapper({ children }: { children: React.ReactNode }) {
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

// Loading component
function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-suwappu-bg">
      <div className="animate-pulse text-suwappu-text-secondary">Loading...</div>
    </div>
  )
}

// Root route
const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
})

// Public route - Welcome/Onboarding
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated) {
      throw redirect({ to: '/home' })
    }
  },
  component: () => (
    <PageWrapper>
      <Welcome />
    </PageWrapper>
  ),
})

// Protected route: Home
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/home',
  beforeLoad: ({ context }) => {
    if (context.auth.isLoading) return
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/' })
    }
  },
  pendingComponent: LoadingScreen,
  component: () => (
    <PageWrapper>
      <Home />
    </PageWrapper>
  ),
})

// Protected route: Swap
const swapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/swap',
  beforeLoad: ({ context }) => {
    if (context.auth.isLoading) return
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/' })
    }
  },
  pendingComponent: LoadingScreen,
  component: () => (
    <PageWrapper>
      <Swap />
    </PageWrapper>
  ),
})

// Protected route: Wallet
const walletRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wallet',
  beforeLoad: ({ context }) => {
    if (context.auth.isLoading) return
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/' })
    }
  },
  pendingComponent: LoadingScreen,
  component: () => (
    <PageWrapper>
      <Wallet />
    </PageWrapper>
  ),
})

// Protected route: Portfolio
const portfolioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/portfolio',
  beforeLoad: ({ context }) => {
    if (context.auth.isLoading) return
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/' })
    }
  },
  pendingComponent: LoadingScreen,
  component: () => (
    <PageWrapper>
      <Portfolio />
    </PageWrapper>
  ),
})

// Protected route: Settings
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: ({ context }) => {
    if (context.auth.isLoading) return
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/' })
    }
  },
  pendingComponent: LoadingScreen,
  component: () => (
    <PageWrapper>
      <Settings />
    </PageWrapper>
  ),
})

// Catch-all route
const catchAllRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '*',
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
  component: () => null,
})

// Route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  homeRoute,
  swapRoute,
  walletRoute,
  portfolioRoute,
  settingsRoute,
  catchAllRoute,
])

// Create router
export function createAppRouter(context: RouterContext) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: 'intent',
  })
}

// Router type for type safety
export type AppRouter = ReturnType<typeof createAppRouter>

// Register router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
