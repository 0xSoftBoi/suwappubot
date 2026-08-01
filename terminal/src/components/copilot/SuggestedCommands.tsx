const SUGGESTIONS = [
  "Swap ETH to USDC",
  "Show my portfolio",
  "Price of SOL",
  "Buy 0.1 ETH of PEPE",
  "Set alert ETH > $4000",
];

interface SuggestedCommandsProps {
  onSelect: (command: string) => void;
}

export function SuggestedCommands({ onSelect }: SuggestedCommandsProps) {
  return (
    <div
      className="flex gap-1 overflow-x-auto px-0.5 py-0.5 scrollbar-none"
      data-testid="suggested-commands"
    >
      {SUGGESTIONS.map((cmd) => (
        <button
          key={cmd}
          onClick={() => onSelect(cmd)}
          className="hairline rounded-terminal-pill shrink-0 px-2.5 py-1 text-[11px]
                     text-terminal-text-secondary transition-colors whitespace-nowrap
                     hover:bg-terminal-bg-tertiary/40 hover:text-terminal-text active:translate-y-px"
        >
          {cmd}
        </button>
      ))}
    </div>
  );
}
