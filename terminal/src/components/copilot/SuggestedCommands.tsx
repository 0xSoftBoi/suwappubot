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
          className="terminal-theme-control terminal-theme-pill shrink-0 px-2.5 py-1 text-[11px]
                     text-terminal-text-secondary transition-colors whitespace-nowrap
                     hover:translate-y-0 focus:translate-y-0 hover:text-terminal-text active:scale-[0.98]"
        >
          {cmd}
        </button>
      ))}
    </div>
  );
}
