import { useState } from 'react'
import type { TrackedTwitterAccount } from '../../types/api'

interface AddAccountModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (handle: string) => void
  onRemove: (handle: string) => void
  accounts: TrackedTwitterAccount[]
}

const SUGGESTED_ACCOUNTS = [
  '@CryptoKaleo',
  '@blaboratory',
  '@GiganticRebirth',
  '@CryptoGodJohn',
  '@EmberCN',
]

export function AddAccountModal({ isOpen, onClose, onAdd, onRemove, accounts }: AddAccountModalProps) {
  const [input, setInput] = useState('')

  if (!isOpen) return null

  const handleAdd = () => {
    const handle = input.trim()
    if (handle) {
      onAdd(handle)
      setInput('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      data-testid="add-account-modal"
    >
      <div className="w-full max-w-md terminal-panel border border-terminal-border-active p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-terminal-text">Manage Twitter Accounts</h3>
          <button
            onClick={onClose}
            className="text-terminal-text-muted hover:text-terminal-text transition-colors text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Input */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="@username"
            className="terminal-input flex-1 text-sm"
            data-testid="account-input"
            autoFocus
          />
          <button
            onClick={handleAdd}
            className="terminal-button text-sm"
            disabled={!input.trim()}
          >
            Add
          </button>
        </div>

        {/* Suggested accounts */}
        <div className="mb-4">
          <p className="text-xs text-terminal-text-muted mb-2">Suggested accounts</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_ACCOUNTS.map(handle => {
              const clean = handle.replace('@', '')
              const isTracked = accounts.some(a => a.handle.toLowerCase() === clean.toLowerCase())
              return (
                <button
                  key={handle}
                  onClick={() => !isTracked && onAdd(handle)}
                  disabled={isTracked}
                  className={`px-2.5 py-1 rounded text-xs transition-colors border ${
                    isTracked
                      ? 'border-terminal-border text-terminal-text-muted cursor-default opacity-50'
                      : 'border-terminal-border text-terminal-text-secondary hover:border-sakura-600 hover:text-sakura-400 cursor-pointer'
                  }`}
                  data-testid="suggested-account"
                >
                  {handle}
                </button>
              )
            })}
          </div>
        </div>

        {/* Currently tracked */}
        {accounts.length > 0 && (
          <div>
            <p className="text-xs text-terminal-text-muted mb-2">
              Tracked accounts ({accounts.length})
            </p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {accounts.map(account => (
                <div
                  key={account.handle}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded bg-terminal-bg-secondary"
                  data-testid="tracked-account"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ backgroundColor: account.avatarColor }}
                    >
                      {account.handle.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="text-sm text-terminal-text">@{account.handle}</span>
                  </div>
                  <button
                    onClick={() => onRemove(account.handle)}
                    className="text-xs text-terminal-text-muted hover:text-bear transition-colors"
                    data-testid="remove-account"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
