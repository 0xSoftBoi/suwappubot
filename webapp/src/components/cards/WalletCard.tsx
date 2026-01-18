export interface WalletCardProps {
  name: string
  address: string
  type: 'passkey' | 'metamask' | 'walletconnect'
  isPrimary?: boolean
  onAction?: () => void
}

export function WalletCard({ name, address, type, isPrimary, onAction }: WalletCardProps) {
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`

  const getIcon = () => {
    switch (type) {
      case 'passkey':
        return (
          <div className="w-10 h-10 rounded-full bg-suwappu-gradient flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
          </div>
        )
      case 'metamask':
        return (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-orange-500 flex items-center justify-center">
            <span className="text-white">🦊</span>
          </div>
        )
      case 'walletconnect':
        return (
          <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center">
            <span className="text-white text-lg">W</span>
          </div>
        )
    }
  }

  return (
    <div className="flex items-center gap-3 p-3">
      {getIcon()}
      <div className="flex-1">
        <p className="font-heading font-semibold text-sm text-suwappu-text">{name}</p>
        <p className="font-mono text-xs text-suwappu-text-secondary">{short}</p>
      </div>
      {isPrimary ? (
        <div className="px-2 py-0.5 bg-suwappu-success/20 rounded-full">
          <span className="text-[10px] text-suwappu-success font-medium">Primary</span>
        </div>
      ) : onAction ? (
        <button onClick={onAction} className="p-1.5 text-suwappu-text-secondary">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>
      ) : null}
    </div>
  )
}
