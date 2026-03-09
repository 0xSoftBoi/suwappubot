import { useState, useRef, useEffect } from 'react'
import { useCopilot } from '../../hooks/useCopilot'
import { ChatMessage } from './ChatMessage'
import { SuggestedCommands } from './SuggestedCommands'

export function CopilotPanel() {
  const { messages, sendMessage, isTyping } = useCopilot()
  const [input, setInput] = useState('')
  const [minimized, setMinimized] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, isTyping])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    sendMessage(trimmed)
    setInput('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSuggestion = (cmd: string) => {
    sendMessage(cmd)
  }

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="terminal-button px-4 py-2 text-sm flex items-center gap-2"
        aria-label="Open AI Co-Pilot"
      >
        {/* Sakura icon */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C9.5 5 7 7.5 7 10.5c0 2 1 3.5 2.5 4.5C8 16 7 17.5 7 19.5c0 1.5.5 2.5.5 2.5s1-1 2.5-1c1 0 1.5.5 2 1 .5-.5 1-1 2-1 1.5 0 2.5 1 2.5 1s.5-1 .5-2.5c0-2-1-3.5-2.5-4.5C16 14 17 12.5 17 10.5 17 7.5 14.5 5 12 2z" />
        </svg>
        AI Co-Pilot
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full" data-testid="copilot-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-terminal-border shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-sakura-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C9.5 5 7 7.5 7 10.5c0 2 1 3.5 2.5 4.5C8 16 7 17.5 7 19.5c0 1.5.5 2.5.5 2.5s1-1 2.5-1c1 0 1.5.5 2 1 .5-.5 1-1 2-1 1.5 0 2.5 1 2.5 1s.5-1 .5-2.5c0-2-1-3.5-2.5-4.5C16 14 17 12.5 17 10.5 17 7.5 14.5 5 12 2z" />
          </svg>
          <span className="text-sm font-semibold text-terminal-text">AI Co-Pilot</span>
        </div>
        <button
          onClick={() => setMinimized(true)}
          className="text-terminal-text-muted hover:text-terminal-text transition-colors p-1"
          aria-label="Minimize"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            type={msg.type}
            data={msg.data}
            timestamp={msg.timestamp}
          />
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex justify-start mb-3">
            <div className="bg-terminal-bg-tertiary border border-terminal-border rounded-lg px-3 py-2 flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-terminal-text-muted animate-pulse" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-terminal-text-muted animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-terminal-text-muted animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* Suggested commands */}
      <div className="px-3 border-t border-terminal-border shrink-0">
        <SuggestedCommands onSelect={handleSuggestion} />
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-terminal-border shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the co-pilot..."
          className="terminal-input flex-1 text-sm"
          data-testid="copilot-input"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="terminal-button p-2 shrink-0"
          aria-label="Send message"
          data-testid="copilot-send"
        >
          {/* Sakura arrow icon */}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
