interface TokenMentionProps {
  symbol: string
}

export function TokenMention({ symbol }: TokenMentionProps) {
  return (
    <button
      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold
                 bg-sakura-600/15 text-sakura-400 hover:bg-sakura-600/25
                 transition-colors cursor-pointer border-none"
      onClick={() => {
        // Navigate to token chart — dispatches a custom event the chart can listen for
        window.dispatchEvent(new CustomEvent('navigate-token', { detail: { symbol } }))
      }}
      data-testid={`token-mention-${symbol}`}
    >
      ${symbol}
    </button>
  )
}
