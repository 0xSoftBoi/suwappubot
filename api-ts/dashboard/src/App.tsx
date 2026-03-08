import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useDarkMode } from './hooks/useDarkMode'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/OverviewPage'
import AgentsPage from './pages/AgentsPage'
import SwapsPage from './pages/SwapsPage'
import WebhooksPage from './pages/WebhooksPage'
import DeveloperPage from './pages/DeveloperPage'

function AuthenticatedLayout() {
  const { darkMode, toggleDarkMode } = useDarkMode()
  const { logout } = useAuth()

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="flex h-screen bg-suwappu-bg dark:bg-dark-bg">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar darkMode={darkMode} onToggleDarkMode={toggleDarkMode} onLogout={logout} />
          <main className="flex-1 overflow-auto p-6">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/swaps" element={<SwapsPage />} />
              <Route path="/webhooks" element={<WebhooksPage />} />
              <Route path="/developer" element={<DeveloperPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-suwappu-bg">
        <div className="animate-spin w-8 h-8 border-4 border-suwappu-magenta border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return <AuthenticatedLayout />
}
