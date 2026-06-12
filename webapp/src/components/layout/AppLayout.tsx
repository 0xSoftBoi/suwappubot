import React from 'react'
import { BottomNav, NavItem } from './BottomNav'

export interface AppLayoutProps {
  children: React.ReactNode
  header?: React.ReactNode
  activeNav?: NavItem
  onNavigate?: (item: NavItem) => void
  hideNav?: boolean
}

export function AppLayout({
  children,
  header,
  activeNav,
  onNavigate,
  hideNav = false,
}: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-suwappu-bg flex flex-col">
      {header}
      <main className={`flex-1 overflow-y-auto ${hideNav ? '' : 'pb-20'}`}>
        {children}
      </main>
      {!hideNav && <BottomNav active={activeNav} onNavigate={onNavigate} />}
    </div>
  )
}
