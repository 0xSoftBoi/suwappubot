type Tab = "swap" | "limit" | "dca";

interface Props {
  active: Tab;
  onSelect: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "swap", label: "Swap" },
  { id: "limit", label: "Limit" },
  { id: "dca", label: "DCA" },
];

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function OrderTabs({ active, onSelect }: Props) {
  return (
    <div className="terminal-theme-inset inline-flex w-full flex-wrap gap-1 p-1">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={joinClasses(
            "terminal-theme-control min-h-11 flex-1 px-3 py-1 text-[13px] font-medium transition-colors hover:translate-y-0 focus:translate-y-0 active:scale-[0.98]",
            active === tab.id
              ? "terminal-theme-control-active text-terminal-text"
              : "text-terminal-text-secondary hover:text-terminal-text",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
