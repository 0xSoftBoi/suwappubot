import { useState, useRef, useEffect } from "react";
import type { TokenSecurity } from "../../types/api";

const RISK_CONFIG = {
  safe: {
    label: "Safe",
    dotClass: "bg-[#2d8a73]",
    borderClass: "border-[#a8d1c0]",
    textClass: "text-[#1d6b57]",
    bgClass: "bg-[#e6f4f0]",
    scoreBg: "bg-[#d4ebe3]",
  },
  caution: {
    label: "Caution",
    dotClass: "bg-[#d38d3c]",
    borderClass: "border-[#efc98a]",
    textClass: "text-[#9c6220]",
    bgClass: "bg-[#fff2da]",
    scoreBg: "bg-[#fde6ba]",
  },
  danger: {
    label: "Danger",
    dotClass: "bg-[#d85a47]",
    borderClass: "border-[#f0b3a9]",
    textClass: "text-[#b44232]",
    bgClass: "bg-[#ffe8e4]",
    scoreBg: "bg-[#ffd3cb]",
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
          isDanger
            ? "animate-pulse-slow shadow-[0_0_6px_rgba(239,68,68,0.3)]"
            : ""
        }`}
      >
        {/* Trust score number */}
        <span
          className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold ${config.scoreBg}`}
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
          className={`absolute z-50 top-full mt-1 right-0 min-w-[200px] rounded-lg border shadow-xl ${
            isDanger
              ? "bg-red-950/95 border-red-500/40"
              : "bg-terminal-bg-secondary border-terminal-border"
          }`}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between px-3 py-2 border-b ${
              isDanger ? "border-red-500/30" : "border-terminal-border"
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
                    ? "bg-[#2d8a73]"
                    : score >= 40
                      ? "bg-[#d38d3c]"
                      : "bg-[#d85a47]"
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
              value={`${security.topHolderPercent.toFixed(1)}%`}
              danger={security.topHolderPercent > 50}
            />
            <DetailRow
              label="Dev Holdings %"
              value={`${(security.devHoldingsPercent ?? 0).toFixed(1)}%`}
              danger={(security.devHoldingsPercent ?? 0) > 20}
            />
            <DetailRow
              label="LP Burned"
              value={`${security.lpBurned.toFixed(1)}%`}
            />
            <DetailRow
              label="Owner Renounced"
              value={security.ownerRenounced ? "Yes" : "NO"}
              danger={!security.ownerRenounced}
            />
          </div>

          {/* Danger warning */}
          {isDanger && (
            <div className="mx-3 mb-2 px-2 py-1.5 rounded bg-red-500/15 border border-red-500/30 text-[10px] text-red-400 font-medium">
              Warning: This token has multiple risk flags. Trade with extreme
              caution.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
