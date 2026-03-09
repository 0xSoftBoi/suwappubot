import { useState } from 'react'

interface AddWalletFormProps {
  onAdd: (address: string, label?: string) => void
}

const ADDRESS_REGEX = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/

export function AddWalletForm({ onAdd }: AddWalletFormProps) {
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = address.trim()

    if (!trimmed) {
      setError('Address required')
      return
    }

    if (!ADDRESS_REGEX.test(trimmed)) {
      setError('Invalid address format')
      return
    }

    onAdd(trimmed, label.trim() || undefined)
    setAddress('')
    setLabel('')
    setError('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end" data-testid="add-wallet-form">
      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={address}
          onChange={e => { setAddress(e.target.value); setError('') }}
          placeholder="0x... or SOL address"
          className="terminal-input w-full text-xs font-mono"
          data-testid="wallet-address-input"
        />
        {error && <span className="text-red-400 text-[10px] mt-0.5 block">{error}</span>}
      </div>
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Label (optional)"
        className="terminal-input text-xs w-28"
        data-testid="wallet-label-input"
      />
      <button type="submit" className="terminal-button text-xs px-3 py-2 shrink-0" data-testid="add-wallet-btn">
        Track
      </button>
    </form>
  )
}
