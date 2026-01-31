import { useNavigate } from 'react-router-dom'

interface Feature {
  icon: string
  label: string
  path: string
  badge?: string
}

const features: Feature[] = [
  { icon: '🔔', label: 'Alerts', path: '/alerts' },
  { icon: '📈', label: 'Limit Orders', path: '/limit-orders' },
  { icon: '🎯', label: 'Points', path: '/points' },
  { icon: '📜', label: 'History', path: '/history' },
  { icon: '📋', label: 'Copy Trade', path: '/copy', badge: 'Soon' },
  { icon: '🎁', label: 'Referrals', path: '/referrals', badge: 'Soon' },
  { icon: '🔗', label: 'Wallets', path: '/settings' },
  { icon: '⚙️', label: 'Settings', path: '/settings' },
]

export function FeatureGrid() {
  const navigate = useNavigate()

  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-3">
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Tools</span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {features.map((feature) => (
          <button
            key={feature.label}
            onClick={() => navigate(feature.path)}
            className="relative flex flex-col items-center gap-1.5 p-2.5 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors"
          >
            <span className="text-xl">{feature.icon}</span>
            <span className="text-[10px] font-heading font-medium text-suwappu-text leading-tight">
              {feature.label}
            </span>
            {feature.badge && (
              <span className="absolute top-1 right-1 px-1 py-0.5 bg-suwappu-magenta-light/40 text-suwappu-magenta-mid text-[8px] font-bold rounded-full leading-none">
                {feature.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
