/**
 * DrawerToggle component - Button to open the settings drawer
 */

import { useAuth } from '../hooks/useAuth'

interface DrawerToggleProps {
  onClick: () => void
}

export function DrawerToggle({ onClick }: DrawerToggleProps) {
  const { telegramUser, linkedWallets } = useAuth()

  // Show wallet indicator if wallets are linked
  const hasWallets = linkedWallets.length > 0

  return (
    <button
      onClick={onClick}
      className="relative flex items-center justify-center w-10 h-10 rounded-full bg-tg-secondary hover:bg-tg-secondary/80 transition-colors"
      aria-label="Open settings"
    >
      {telegramUser?.photo_url ? (
        <img
          src={telegramUser.photo_url}
          alt={telegramUser.first_name}
          className="w-10 h-10 rounded-full"
        />
      ) : (
        <svg className="w-5 h-5 text-tg-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      )}

      {/* Wallet indicator dot */}
      {hasWallets && (
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-tg-bg" />
      )}
    </button>
  )
}
