import type { Alert } from "../../types/api";

interface Props {
  alert: Alert;
  onDelete: (id: string) => void;
}

const statusColors: Record<string, string> = {
  active: "bg-[#22c55e]",
  inactive: "bg-gray-500",
  triggered: "bg-orange-500",
};

export function AlertCard({ alert, onDelete }: Props) {
  const conditionIcon =
    alert.alertType === "price_above"
      ? "\u2191"
      : alert.alertType === "price_below"
        ? "\u2193"
        : "\u26A1";
  const conditionLabel =
    alert.alertType === "price_above"
      ? "Above"
      : alert.alertType === "price_below"
        ? "Below"
        : "Vol Spike";

  return (
    <div className="terminal-theme-card flex items-center gap-3 p-[var(--terminal-space-card)] transition-colors hover:border-terminal-border-active">
      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColors[alert.status] || "bg-gray-500"}`}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-terminal-text">
            {alert.tokenSymbol}
          </span>
          <span className="text-xs text-terminal-text-muted">
            {conditionIcon} {conditionLabel}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-terminal-text-secondary">
            Target:{" "}
            <span className="font-mono text-terminal-text">
              ${alert.targetValue.toLocaleString()}
            </span>
          </span>
          {alert.currentPrice !== undefined && (
            <span className="text-xs text-terminal-text-muted">
              Now:{" "}
              <span className="font-mono">
                ${alert.currentPrice.toLocaleString()}
              </span>
            </span>
          )}
        </div>
      </div>

      <button
        onClick={() => onDelete(alert.id)}
        className="text-terminal-text-muted hover:text-bear transition-colors flex-shrink-0 text-sm px-1"
        title="Delete alert"
      >
        ✕
      </button>
    </div>
  );
}
