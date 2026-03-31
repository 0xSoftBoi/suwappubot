import { useState } from 'react'
import { useTweetMonitor, type SentimentFilter } from '../../hooks/useTweetMonitor'
import { TweetCard } from './TweetCard'
import { AddAccountModal } from './AddAccountModal'

const SENTIMENT_FILTERS: { id: SentimentFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'bullish', label: 'Bullish' },
  { id: 'bearish', label: 'Bearish' },
  { id: 'neutral', label: 'Neutral' },
]

export function TweetMonitorPanel() {
  const {
    accounts,
    tweets,
    sentimentFilter,
    setSentimentFilter,
    addAccount,
    removeAccount,
  } = useTweetMonitor()

  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="p-4 flex flex-col gap-3 h-full" data-testid="tweet-monitor-panel">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-sm font-semibold text-terminal-text">
          Tweet Monitor
          {accounts.length > 0 && (
            <span className="ml-2 text-xs text-terminal-text-muted font-normal">
              {accounts.length} account{accounts.length !== 1 ? 's' : ''}
            </span>
          )}
        </h3>
        <button
          onClick={() => setModalOpen(true)}
          className="terminal-button text-xs px-3 py-1"
          data-testid="add-account-btn"
        >
          Add Account
        </button>
      </div>

      {/* Sentiment filter bar */}
      <div className="flex items-center gap-1 shrink-0" data-testid="sentiment-filters">
        {SENTIMENT_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setSentimentFilter(f.id)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              sentimentFilter === f.id
                ? 'bg-sakura-600/20 text-sakura-400'
                : 'text-terminal-text-secondary hover:text-terminal-text'
            }`}
            data-testid={`filter-${f.id}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tweet feed */}
      <div className="flex-1 overflow-y-auto space-y-2" data-testid="tweet-feed">
        {accounts.length === 0 ? (
          <div className="text-center text-terminal-text-muted text-sm py-8">
            <p className="mb-2">No accounts tracked</p>
            <p className="text-xs">Click "Add Account" to start monitoring tweets</p>
          </div>
        ) : tweets.length === 0 ? (
          <div className="text-center text-terminal-text-muted text-sm py-8 animate-pulse">
            Waiting for tweets...
          </div>
        ) : (
          tweets.map(tweet => (
            <TweetCard key={tweet.id} tweet={tweet} />
          ))
        )}
      </div>

      {/* Modal */}
      <AddAccountModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={addAccount}
        onRemove={removeAccount}
        accounts={accounts}
      />
    </div>
  )
}
