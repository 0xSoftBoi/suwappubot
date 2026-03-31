import { QuoteCard } from './QuoteCard'
import { PortfolioSummary } from './PortfolioSummary'

export interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  type: 'text' | 'quote' | 'portfolio' | 'error'
  data?: Record<string, unknown>
  timestamp: number
}

export function ChatMessage({ role, content, type, data, timestamp }: ChatMessageProps) {
  const isUser = role === 'user'
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-sakura-900/20 border border-sakura-800/30'
            : 'bg-terminal-bg-tertiary border border-terminal-border'
        }`}
      >
        {type === 'error' ? (
          <p className="text-sm text-red-400 whitespace-pre-wrap">{content}</p>
        ) : (
          <p className="text-sm text-terminal-text whitespace-pre-wrap">{content}</p>
        )}

        {type === 'quote' && data && (
          <div className="mt-2">
            <QuoteCard data={data} />
          </div>
        )}

        {type === 'portfolio' && data && (
          <div className="mt-2">
            <PortfolioSummary data={data} />
          </div>
        )}

        <span className="block text-[10px] text-terminal-text-muted mt-1 select-none">
          {time}
        </span>
      </div>
    </div>
  )
}
