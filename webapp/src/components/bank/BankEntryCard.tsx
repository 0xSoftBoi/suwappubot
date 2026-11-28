import { useNavigate } from 'react-router-dom'

export function BankEntryCard() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate('/bank')}
      className="w-full flex items-center justify-between gap-3 rounded-suwappu-xl bg-linear-to-br from-suwappu-magenta-mid to-suwappu-purple-deep px-4 py-3 text-left text-white shadow-suwappu-2 min-h-[64px]"
    >
      <span className="min-w-0">
        <span className="block font-heading font-bold text-sm">Suwappu Bank</span>
        <span className="block text-[11px] text-white/80">Accounts, send, earn, cards and credit in stablecoins</span>
      </span>
      <span aria-hidden className="text-lg">›</span>
    </button>
  )
}
