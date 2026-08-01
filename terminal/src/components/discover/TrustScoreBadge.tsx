interface TrustScoreBadgeProps {
  score?: number;
  level?: "safe" | "caution" | "danger";
}

export function TrustScoreBadge({ score, level }: TrustScoreBadgeProps) {
  if (score === undefined) return null;

  // Neutral by default; green only for a genuinely "safe" verdict.
  const colorClass =
    level === "safe" || (!level && score >= 80)
      ? "bg-bull/10 text-bull border-bull/30"
      : level === "caution" || (!level && score >= 50)
        ? "bg-terminal-warn/10 text-terminal-warn border-terminal-warn/30"
        : "bg-bear/10 text-bear border-bear/30";

  return (
    <span
      className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-mono tnum border ${colorClass}`}
      aria-label={`Trust score ${score}`}
    >
      {score}
    </span>
  );
}
