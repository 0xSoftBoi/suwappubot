import { useTweetMonitor, type SentimentFilter } from '../../hooks/useTweetMonitor'
import { AddAccountModal } from './AddAccountModal'
import { TweetCard } from './TweetCard'
import { useState } from 'react'

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
    isLoading,
    error,
  } = useTweetMonitor()

  const [isModalOpen, setIsModalOpen] = useState(false)

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
          onClick={() => setIsModalOpen(true)}
          className="terminal-button text-xs px-3 py-1"
          data-testid="add-account-btn"
        >
          Manage Accounts
        </button>
      </div>

      <div className="text-xs text-terminal-text-muted">
        Tracked account persistence is connected. Tweet provider is not connected yet.
      </div>
      {error && (
        <div className="text-xs text-bear" data-testid="tweet-monitor-error">
          {error instanceof Error ? error.message : 'Tweet monitor request failed.'}
        </div>
      )}
      {isLoading && (
        <div className="text-xs text-terminal-text-muted" data-testid="tweet-monitor-loading">
          Loading tracked accounts...
        </div>
      )}

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
            <p className="text-xs">Tweet provider is not connected yet.</p>
          </div>
        ) : tweets.length === 0 ? (
          <div className="text-center text-terminal-text-muted text-sm py-8">
            Tweet provider is not connected yet.
          </div>
        ) : (
          tweets.map(tweet => (
            <TweetCard key={tweet.id} tweet={tweet} />
          ))
        )}
      </div>

      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={addAccount}
        onRemove={removeAccount}
        accounts={accounts}
      />
    </div>
  )
}
