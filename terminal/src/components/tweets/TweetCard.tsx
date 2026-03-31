import type { TweetData } from '../../types/api'
import { TokenMention } from './TokenMention'

interface TweetCardProps {
  tweet: TweetData
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const sentimentConfig = {
  bullish: { label: 'Bullish', className: 'bg-bull/15 text-bull' },
  bearish: { label: 'Bearish', className: 'bg-bear/15 text-bear' },
  neutral: { label: 'Neutral', className: 'bg-terminal-bg-tertiary text-terminal-text-muted' },
}

function renderContentWithMentions(content: string, tokenMentions: string[]) {
  if (tokenMentions.length === 0) return <span>{content}</span>

  const pattern = new RegExp(`(\\$(?:${tokenMentions.join('|')}))`, 'g')
  const parts = content.split(pattern)

  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\$([A-Z]{2,10})$/)
        if (match && tokenMentions.includes(match[1])) {
          return <TokenMention key={i} symbol={match[1]} />
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

export function TweetCard({ tweet }: TweetCardProps) {
  const initials = tweet.authorName.slice(0, 2).toUpperCase()
  const sentiment = sentimentConfig[tweet.sentiment]

  return (
    <div
      className="p-3 border border-terminal-border rounded-sm hover:border-terminal-border-active transition-colors"
      data-testid="tweet-card"
    >
      {/* Author row */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
          style={{ backgroundColor: tweet.authorAvatarColor }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-terminal-text">{tweet.authorName}</span>
          <span className="text-xs text-terminal-text-muted ml-1.5">@{tweet.authorHandle}</span>
        </div>
        <span className="text-xs text-terminal-text-muted shrink-0">
          {formatRelativeTime(tweet.timestamp)}
        </span>
      </div>

      {/* Content */}
      <p className="text-sm text-terminal-text leading-relaxed mb-2">
        {renderContentWithMentions(tweet.content, tweet.tokenMentions)}
      </p>

      {/* Footer: sentiment + engagement */}
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${sentiment.className}`}
          data-testid="sentiment-badge"
        >
          {sentiment.label}
        </span>
        <div className="flex items-center gap-3 text-xs text-terminal-text-muted">
          <span data-testid="tweet-likes">{formatCount(tweet.likes)} likes</span>
          <span data-testid="tweet-retweets">{formatCount(tweet.retweets)} RTs</span>
        </div>
      </div>
    </div>
  )
}
