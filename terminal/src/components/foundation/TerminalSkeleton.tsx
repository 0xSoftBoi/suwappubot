import type { CSSProperties } from "react";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type Radius = "card" | "control" | "inset" | "panel" | "pill";

const radiusVar: Record<Radius, string> = {
  card: "var(--terminal-radius-card)",
  control: "var(--terminal-radius-control)",
  inset: "var(--terminal-radius-inset)",
  panel: "var(--terminal-radius-panel)",
  pill: "var(--terminal-radius-pill)",
};

function toSize(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * Shimmer placeholder bar. Use instead of spinners on data panels.
 *
 * Reduced motion: the shimmer animation is inside a
 * `prefers-reduced-motion: no-preference` block, so it degrades to a static
 * bar automatically (see `.terminal-skeleton` in index.css).
 *
 * The bar is `aria-hidden` by default; pass `label` when the skeleton is the
 * only thing announcing that data is loading.
 */
export function TerminalSkeleton({
  width = "100%",
  height = 12,
  radius = "card",
  className,
  label,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: Radius;
  className?: string;
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-live={label ? "polite" : undefined}
      aria-hidden={label ? undefined : true}
      className={joinClasses("terminal-skeleton", className)}
      style={{
        width: toSize(width),
        height: toSize(height),
        borderRadius: radiusVar[radius],
        ...style,
      }}
    >
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/**
 * Stacked skeleton lines for prose/summary blocks. The last line is short so
 * the block reads like text rather than a grey slab.
 */
export function TerminalSkeletonText({
  lines = 3,
  height = 10,
  className,
  label,
}: {
  lines?: number;
  height?: number | string;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role={label ? "status" : undefined}
      aria-live={label ? "polite" : undefined}
      aria-hidden={label ? undefined : true}
      className={joinClasses("grid gap-1.5", className)}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      {Array.from({ length: lines }).map((_, index) => (
        <TerminalSkeleton
          key={index}
          height={height}
          width={index === lines - 1 ? "62%" : "100%"}
        />
      ))}
    </div>
  );
}

/**
 * Table/list loading state — mirrors a dense data grid so the layout doesn't
 * jump when real rows arrive.
 */
export function TerminalSkeletonRows({
  rows = 5,
  columns = 3,
  className,
  label,
}: {
  rows?: number;
  columns?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role={label ? "status" : undefined}
      aria-live={label ? "polite" : undefined}
      aria-hidden={label ? undefined : true}
      className={joinClasses("grid gap-1", className)}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center gap-3 px-1 py-1.5"
          style={{ opacity: 1 - rowIndex * (0.5 / Math.max(rows, 1)) }}
        >
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <TerminalSkeleton
              key={columnIndex}
              height={10}
              width={columnIndex === 0 ? "34%" : `${Math.round(56 / (columns - 1 || 1))}%`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
