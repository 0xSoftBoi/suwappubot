import { useNavigate } from 'react-router-dom'

export function Welcome() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-suwappu-bg flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-24 h-24 mb-6 bg-suwappu-gradient rounded-full flex items-center justify-center shadow-suwappu-glow">
          <span className="text-white text-4xl font-bold">S</span>
        </div>

        <h1 className="font-display text-4xl text-suwappu-magenta-mid mb-2">Suwappu</h1>
        <p className="text-suwappu-text-secondary text-center mb-8 max-w-xs">
          Follow real trader moments, discover what is moving, and trade across chains.
        </p>

        <div className="w-full max-w-sm space-y-3">
          <button
            onClick={() => navigate('/discover')}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover"
          >
            Browse Social Pulse
          </button>

          <p className="text-center text-xs text-suwappu-text-secondary pt-1">
            No login required to browse. Wallet proof is requested only when you claim a creator profile.
          </p>
        </div>
      </div>

      <div className="p-4 text-center">
        <p className="text-[10px] text-suwappu-text-secondary">
          Trading accounts continue to sign in through the Suwappu Telegram app.
        </p>
      </div>
    </div>
  )
}
