import { useState, useCallback } from 'react'
import { api } from '../lib/api'

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  type: 'text' | 'quote' | 'portfolio' | 'error'
  data?: Record<string, unknown>
  timestamp: number
}

let nextId = 0
function genId() {
  return `msg-${Date.now()}-${nextId++}`
}

const WELCOME_MESSAGE: CopilotMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Welcome to the AI Co-Pilot. I can help you swap tokens, check prices, and view your portfolio. Try one of the suggestions below or type a command.',
  type: 'text',
  timestamp: Date.now(),
}

export function useCopilot() {
  const [messages, setMessages] = useState<CopilotMessage[]>([WELCOME_MESSAGE])
  const [isTyping, setIsTyping] = useState(false)

  const addMessage = useCallback((msg: CopilotMessage) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      const userMsg: CopilotMessage = {
        id: genId(),
        role: 'user',
        content: trimmed,
        type: 'text',
        timestamp: Date.now(),
      }
      addMessage(userMsg)
      setIsTyping(true)

      try {
        const response = await api.copilotCommand(trimmed)
        addMessage({
          id: genId(),
          role: 'assistant',
          content: response.content,
          type: response.type,
          data: response.data,
          timestamp: Date.now(),
        })
      } catch (err: unknown) {
        const detail =
          err && typeof err === 'object' && 'detail' in err
            ? (err as { detail: string }).detail
            : 'Something went wrong. Please try again.'
        addMessage({
          id: genId(),
          role: 'assistant',
          content: detail,
          type: 'error',
          timestamp: Date.now(),
        })
      } finally {
        setIsTyping(false)
      }
    },
    [addMessage],
  )

  return { messages, sendMessage, isTyping }
}
