import { useState } from "react";

interface Props {
  value: number;
  onChange: (value: number) => void;
}

const PRESETS = [0.1, 0.5, 1.0, 3.0];

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function SlippageControl({ value, onChange }: Props) {
  const [custom, setCustom] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="terminal-theme-caption shrink-0 px-1 text-[10px] uppercase text-terminal-text-muted">
        Slippage
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            onClick={() => {
              onChange(preset);
              setCustom(false);
            }}
            className={joinClasses(
              "terminal-theme-control min-h-[32px] min-w-[56px] px-2.5 py-1 font-mono text-[11px] transition-colors hover:translate-y-0 focus:translate-y-0 active:scale-[0.98]",
              !custom && value === preset
                ? "terminal-theme-control-active text-terminal-text"
                : "text-terminal-text-secondary hover:text-terminal-text",
            )}
          >
            {preset}%
          </button>
        ))}
        <label
          className={joinClasses(
            "terminal-theme-control relative flex min-h-[32px] min-w-[72px] flex-1 items-center px-2.5 hover:translate-y-0 focus-within:translate-y-0",
            custom
              ? "terminal-theme-control-active text-terminal-text"
              : "text-terminal-text-secondary",
          )}
        >
          <input
            type="text"
            value={custom ? value : ""}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val >= 0 && val <= 50) {
                onChange(val);
                setCustom(true);
              }
            }}
            onFocus={() => setCustom(true)}
            inputMode="decimal"
            placeholder="Custom"
            className="w-full bg-transparent pr-4 text-center font-mono text-[11px] outline-none placeholder-terminal-text-muted"
          />
          <span className="pointer-events-none absolute right-2 text-[10px] text-terminal-text-muted">
            %
          </span>
        </label>
      </div>
    </div>
  );
}
