const SUGGESTIONS = [
  'Swap ETH to USDC',
  'Show my portfolio',
  'Price of SOL',
  'Buy 0.1 ETH of PEPE',
  'Set alert ETH > $4000',
]

interface SuggestedCommandsProps {
  onSelect: (command: string) => void
}

export function SuggestedCommands({ onSelect }: SuggestedCommandsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto py-2 px-1 scrollbar-none" data-testid="suggested-commands">
      {SUGGESTIONS.map((cmd) => (
        <button
          key={cmd}
          onClick={() => onSelect(cmd)}
          className="shrink-0 border border-terminal-border rounded-full px-3 py-1 text-xs
                     text-terminal-text-secondary hover:border-sakura-600 hover:text-terminal-text
                     transition-colors whitespace-nowrap"
        >
          {cmd}
        </button>
      ))}
    </div>
  )
}
