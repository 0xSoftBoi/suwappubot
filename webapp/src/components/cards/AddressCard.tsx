import { useState } from 'react'

export interface AddressCardProps {
  address: string
  label?: string
  onCopy?: (address: string) => void
}

export function AddressCard({ address, label, onCopy }: AddressCardProps) {
  const [copied, setCopied] = useState(false)
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      onCopy?.(address)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available
    }
  }

  return (
    <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
      {label && <p className="text-xs text-suwappu-text-secondary mb-1">{label}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-suwappu-text">{short}</span>
        <button
          onClick={copy}
          className="p-1.5 text-suwappu-text-secondary hover:text-suwappu-magenta-mid transition-colors"
        >
          {copied ? (
            <svg className="w-4 h-4 text-suwappu-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
