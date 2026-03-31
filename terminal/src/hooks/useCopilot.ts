import { useState, useCallback } from 'react'
import { api } from '../lib/api'
import { detectIntent, formatQuoteResponse, formatPortfolioResponse, formatPriceResponse } from '../lib/copilot'

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

const HELP_TEXT =
  'Available commands:\n' +
  '  - "Swap ETH to USDC" — get a swap quote\n' +
  '  - "Show my portfolio" — view holdings\n' +
  '  - "Price of SOL" — check token price\n' +
  '  - "Buy 0.1 ETH of PEPE" — get a swap quote\n' +
  '  - "Set alert ETH > $4000" — set a price alert'

function extractToken(text: string): string {
  const words = text.replace(/[^\w\s]/g, '').split(/\s+/)
  const skipWords = new Set([
    'price', 'of', 'the', 'what', 'is', 'how', 'much', 'does', 'cost',
    'show', 'me', 'get', 'check', 'for', 'a', 'an', 'worth',
  ])
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i].toUpperCase()
    if (w.length >= 2 && !skipWords.has(words[i].toLowerCase())) {
      return w
    }
  }
  return words[words.length - 1]?.toUpperCase() || ''
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
        const intent = detectIntent(trimmed)

        let response: CopilotMessage

        switch (intent) {
          case 'swap': {
            const quoteData = await api.agentSwapQuote(trimmed)
            const formatted = formatQuoteResponse(quoteData)
            response = {
              id: genId(),
              role: 'assistant',
              content: formatted.content,
              type: 'quote',
              data: formatted.data,
              timestamp: Date.now(),
            }
            break
          }

          case 'portfolio': {
            const portfolio = await api.getPortfolio()
            const formatted = formatPortfolioResponse(portfolio)
            response = {
              id: genId(),
              role: 'assistant',
              content: formatted.content,
              type: 'portfolio',
              data: formatted.data,
              timestamp: Date.now(),
            }
            break
          }

          case 'price': {
            const token = extractToken(trimmed)
            const results = await api.searchTokens(token)
            if (results.length > 0) {
              const formatted = formatPriceResponse(results[0])
              response = {
                id: genId(),
                role: 'assistant',
                content: formatted.content,
                type: 'text',
                data: formatted.data,
                timestamp: Date.now(),
              }
            } else {
              response = {
                id: genId(),
                role: 'assistant',
                content: `Could not find token matching "${token}".`,
                type: 'error',
                timestamp: Date.now(),
              }
            }
            break
          }

          default: {
            response = {
              id: genId(),
              role: 'assistant',
              content: HELP_TEXT,
              type: 'text',
              timestamp: Date.now(),
            }
          }
        }

        addMessage(response)
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
