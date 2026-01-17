interface NavigationProps {
  activeTab: 'portfolio' | 'history'
  onTabChange: (tab: 'portfolio' | 'history') => void
}

export function Navigation({ activeTab, onTabChange }: NavigationProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-tg-bg border-t border-tg-secondary">
      <div className="flex">
        <button
          onClick={() => onTabChange('portfolio')}
          className={`flex-1 py-3 flex flex-col items-center gap-1 transition-colors ${
            activeTab === 'portfolio' ? 'text-tg-button' : 'text-tg-hint'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <span className="text-xs">Portfolio</span>
        </button>
        <button
          onClick={() => onTabChange('history')}
          className={`flex-1 py-3 flex flex-col items-center gap-1 transition-colors ${
            activeTab === 'history' ? 'text-tg-button' : 'text-tg-hint'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs">History</span>
        </button>
      </div>
    </nav>
  )
}
