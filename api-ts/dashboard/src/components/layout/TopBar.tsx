interface TopBarProps {
  darkMode: boolean
  onToggleDarkMode: () => void
  onLogout: () => void
}

export default function TopBar({ darkMode, onToggleDarkMode, onLogout }: TopBarProps) {
  return (
    <header className="h-14 shrink-0 border-b border-suwappu-sakura-light/30 dark:border-dark-border flex items-center justify-between px-6 bg-white/80 dark:bg-dark-surface/80 backdrop-blur-xl">
      <div />
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleDarkMode}
          className="p-2 rounded-suwappu-md hover:bg-suwappu-sakura-light/20 dark:hover:bg-dark-border/50 transition-colors"
          title={darkMode ? 'Light mode' : 'Dark mode'}
        >
          {darkMode ? (
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-suwappu-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
            </svg>
          )}
        </button>
        <button
          onClick={onLogout}
          className="px-3 py-1.5 text-sm text-suwappu-text-secondary dark:text-gray-400 hover:text-suwappu-error rounded-suwappu-md hover:bg-suwappu-error/10 transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  )
}
