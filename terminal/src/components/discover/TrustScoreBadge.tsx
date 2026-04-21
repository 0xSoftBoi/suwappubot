interface TrustScoreBadgeProps {
  score?: number;
  level?: "safe" | "caution" | "danger";
}

export function TrustScoreBadge({ score, level }: TrustScoreBadgeProps) {
  if (score === undefined) return null;

  const colorClass =
    level === "safe" || (!level && score >= 80)
      ? "bg-[#e6f4f0] text-[#1d6b57] border-[#a8d1c0]"
      : level === "caution" || (!level && score >= 50)
        ? "bg-[#fff2da] text-[#9c6220] border-[#efc98a]"
        : "bg-[#ffe8e4] text-[#b44232] border-[#f0b3a9]";

  return (
    <span
      className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-mono border ${colorClass}`}
    >
      {score}
    </span>
  );
}
