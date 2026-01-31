import { useAuth, formatAddress } from '../../contexts/AuthContext'
import { getTelegramUser } from '../../lib/telegram'

export interface UserHeaderProps {
  showSettings?: boolean
  onSettingsClick?: () => void
}

export function UserHeader({ showSettings = true, onSettingsClick }: UserHeaderProps) {
  const { linkedWallets, walletInfo } = useAuth()
  const telegramUser = getTelegramUser()

  // Get display name
  const displayName = telegramUser?.first_name || telegramUser?.username || 'Anon'
  const username = telegramUser?.username ? `@${telegramUser.username}` : null

  // Get wallet address to display
  const walletAddress = linkedWallets[0]?.address || walletInfo?.address || null

  // Get avatar - use Telegram photo or generate from name
  const avatarUrl = telegramUser?.photo_url
  const avatarInitial = displayName.charAt(0).toUpperCase()

  // Premium badge
  const isPremium = telegramUser?.is_premium

  return (
    <header className="bg-gradient-to-r from-suwappu-purple-deep to-suwappu-magenta-mid text-white">
      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="relative">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-12 h-12 rounded-full border-2 border-white/30 shadow-lg"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-white/20 border-2 border-white/30 flex items-center justify-center shadow-lg">
                <span className="text-xl font-bold">{avatarInitial}</span>
              </div>
            )}
            {isPremium && (
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-yellow-400 rounded-full flex items-center justify-center shadow">
                <span className="text-xs">⭐</span>
              </div>
            )}
          </div>

          {/* User Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-heading font-bold text-lg truncate">{displayName}</h1>
              {isPremium && (
                <span className="px-1.5 py-0.5 bg-yellow-400/20 text-yellow-200 text-[10px] font-bold rounded-full">
                  PRO
                </span>
              )}
            </div>
            {username && (
              <p className="text-white/70 text-sm truncate">{username}</p>
            )}
            {walletAddress && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-4 h-4 bg-white/20 rounded-full flex items-center justify-center">
                  <span className="text-[10px]">💎</span>
                </div>
                <span className="text-white/80 text-xs font-mono">
                  {formatAddress(walletAddress)}
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(walletAddress)}
                  className="p-0.5 hover:bg-white/10 rounded transition-colors"
                  title="Copy address"
                >
                  <svg className="w-3 h-3 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Settings Button */}
          {showSettings && (
            <button
              onClick={onSettingsClick}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
