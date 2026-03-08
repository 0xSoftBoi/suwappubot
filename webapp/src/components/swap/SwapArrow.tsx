export interface SwapArrowProps {
  onClick?: () => void
}

export function SwapArrow({ onClick }: SwapArrowProps) {
  return (
    <div className="flex justify-center -my-2 relative z-10">
      <button
        onClick={onClick}
        className="w-10 h-10 bg-white rounded-suwappu-pill shadow-suwappu-2 flex items-center justify-center text-suwappu-magenta-mid hover:bg-suwappu-sakura-light transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      </button>
    </div>
  )
}
