import { useState } from "react";
import type { AlertType } from "../../types/api";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

interface Props {
  onSubmit: (data: {
    tokenSymbol: string;
    alertType: AlertType;
    targetValue: number;
  }) => void;
  isLoading: boolean;
}

const alertTypes: { value: AlertType; label: string }[] = [
  { value: "price_above", label: "Price Above" },
  { value: "price_below", label: "Price Below" },
  { value: "volume_spike", label: "Volume Spike" },
];

export function CreateAlertForm({ onSubmit, isLoading }: Props) {
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [alertType, setAlertType] = useState<AlertType>("price_above");
  const [targetValue, setTargetValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(targetValue);
    if (!tokenSymbol || isNaN(parsed) || parsed <= 0) return;
    onSubmit({
      tokenSymbol: tokenSymbol.toUpperCase(),
      alertType,
      targetValue: parsed,
    });
    setTokenSymbol("");
    setTargetValue("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="flex-1 min-w-0">
        <label className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
          Token
        </label>
        <input
          type="text"
          value={tokenSymbol}
          onChange={(e) => setTokenSymbol(e.target.value)}
          placeholder="ETH"
          className="terminal-input text-sm w-full mt-0.5"
        />
      </div>

      <div className="flex-shrink-0">
        <label className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
          Type
        </label>
        <div
          className="flex gap-1 mt-0.5"
          role="group"
          aria-label="Alert type selector"
        >
          {alertTypes.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setAlertType(t.value)}
              className={joinClasses(
                "terminal-theme-control min-h-[32px] px-2.5 py-1.5 text-[11px] transition-colors hover:translate-y-0 focus:translate-y-0 active:scale-[0.98]",
                alertType === t.value
                  ? "terminal-theme-control-active text-terminal-text"
                  : "text-terminal-text-muted hover:text-terminal-text",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="w-24 flex-shrink-0">
        <label className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
          Target ($)
        </label>
        <input
          type="number"
          value={targetValue}
          onChange={(e) => setTargetValue(e.target.value)}
          placeholder="0.00"
          step="any"
          className="terminal-input text-sm w-full mt-0.5"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading || !tokenSymbol || !targetValue || !(parseFloat(targetValue) > 0)}
        className="terminal-button text-sm px-3 py-1.5 flex-shrink-0 disabled:opacity-50"
      >
        {isLoading ? "..." : "Create Alert"}
      </button>
    </form>
  );
}
