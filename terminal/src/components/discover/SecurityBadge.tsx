import { useState, useRef, useEffect } from "react";
import type { TokenSecurity } from "../../types/api";

// Neutral dark chips by default; green is reserved for a genuinely "safe"
// verdict (semantic, not decorative), amber for caution, red for danger.
const RISK_CONFIG = {
  safe: {
    label: "Safe",
    dotClass: "bg-bull",
    borderClass: "border-bull/30",
    textClass: "text-bull",
    bgClass: "bg-bull/10",
    scoreBg: "bg-bull/20",
  },
  caution: {
    label: "Caution",
    dotClass: "bg-terminal-warn",
    borderClass: "border-terminal-warn/30",
    textClass: "text-terminal-warn",
    bgClass: "bg-terminal-warn/10",
    scoreBg: "bg-terminal-warn/20",
  },
  danger: {
    label: "Danger",
    dotClass: "bg-bear",
    borderClass: "border-bear/30",
    textClass: "text-bear",
    bgClass: "bg-bear/10",
    scoreBg: "bg-bear/20",
  },
} as const;

function DetailRow({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-terminal-text-muted text-[10px]">{label}</span>
      <span
        className={`text-[10px] font-mono ${danger ? "text-red-400 font-semibold" : "text-terminal-text"}`}
      >
        {value}
      </span>
    </div>
  );
}

interface SecurityBadgeProps {
  security: TokenSecurity | null | undefined;
  loading?: boolean;
  compact?: boolean;
}

export function SecurityBadge({
  security,
  loading,
  compact,
}: SecurityBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(event.target as Node)
      ) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-terminal-border text-terminal-text-muted animate-pulse">
        <span className="w-3 h-3 rounded-full bg-terminal-bg-tertiary" />
        ...
      </span>
    );
  }

  if (!security) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-terminal-border text-terminal-text-muted">
        N/A
      </span>
    );
  }

  const config = RISK_CONFIG[security.riskLevel];
  const score = security.trustScore ?? 0;
  const isDanger = security.riskLevel === "danger";

  return (
    <div className="relative inline-block" ref={tooltipRef}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] border transition-all cursor-pointer ${config.borderClass} ${config.bgClass} ${config.textClass} hover:brightness-125 ${
          isDanger ? "animate-pulse-slow" : ""
        }`}
        aria-label={`Trust score ${score} of 100 — ${config.label}`}
        aria-expanded={expanded}
      >
        {/* Trust score number */}
        <span
          className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold ${config.scoreBg}`}
        >
          {score}
        </span>
        {!compact && (
          <>
            <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
            <span className="font-medium">{config.label}</span>
          </>
        )}
        {/* Expand indicator */}
        <svg
          className={`w-2.5 h-2.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 10 10"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>

      {/* Expanded tooltip */}
      {expanded && (
        <div
          className={`terminal-theme-overlay absolute z-50 top-full mt-1 right-0 min-w-[200px] rounded-lg border ${
            isDanger
              ? "bg-bear-dim border-bear/40"
              : "bg-terminal-bg-secondary border-terminal-border"
          }`}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between px-3 py-2 border-b ${
              isDanger ? "border-bear/30" : "border-terminal-border"
            }`}
          >
            <span className={`text-xs font-semibold ${config.textClass}`}>
              Trust Score: {score}/100
            </span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${config.borderClass} ${config.bgClass} ${config.textClass}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
              {config.label}
            </span>
          </div>

          {/* Score bar */}
          <div className="px-3 pt-2 pb-1">
            <div className="w-full h-1.5 bg-terminal-bg-tertiary rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  score >= 70
                    ? "bg-bull"
                    : score >= 40
                      ? "bg-terminal-warn"
                      : "bg-bear"
                }`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>

          {/* Detail rows */}
          <div className="flex flex-col gap-1.5 px-3 py-2">
            <DetailRow
              label="Honeypot"
              value={security.isHoneypot ? "YES" : "No"}
              danger={security.isHoneypot}
            />
            <DetailRow
              label="Mint Authority"
              value={security.mintAuthority ? "ENABLED" : "Disabled"}
              danger={security.mintAuthority}
            />
            <DetailRow
              label="Top Holder %"
              value={`${(security.topHolderPercent ?? 0).toFixed(1)}%`}
              danger={(security.topHolderPercent ?? 0) > 50}
            />
            <DetailRow
              label="Dev Holdings %"
              value={`${(security.devHoldingsPercent ?? 0).toFixed(1)}%`}
              danger={(security.devHoldingsPercent ?? 0) > 20}
            />
            <DetailRow
              label="LP Burned"
              value={`${(security.lpBurned ?? 0).toFixed(1)}%`}
            />
            <DetailRow
              label="Owner Renounced"
              value={security.ownerRenounced ? "Yes" : "NO"}
              danger={!security.ownerRenounced}
            />
          </div>

          {/* Danger warning */}
          {isDanger && (
            <div className="mx-3 mb-2 px-2 py-1.5 rounded bg-bear/15 border border-bear/30 text-[10px] text-bear font-medium">
              Warning: This token has multiple risk flags. Trade with extreme
              caution.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
