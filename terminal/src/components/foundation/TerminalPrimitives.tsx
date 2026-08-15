import type { ReactNode } from "react";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/**
 * `accent` / `up` / `down` are semantic: accent = interactive/brand emphasis,
 * up/down = PnL or price direction ONLY (never decorative).
 */
type Tone = "neutral" | "warm" | "sky" | "accent" | "up" | "down";

const toneClasses: Record<Tone, string> = {
  neutral:
    "border-terminal-border bg-terminal-bg-secondary text-terminal-text-secondary",
  warm: "border-sakura-300 bg-sakura-50 text-sakura-400",
  sky: "border-chain-solana/20 bg-chain-solana/5 text-chain-solana",
  accent: "border-terminal-accent/35 bg-terminal-accent/10 text-terminal-accent",
  up: "border-bull/35 bg-bull/10 text-bull",
  down: "border-bear/35 bg-bear/10 text-bear",
};

export function TerminalPage({ children }: { children: ReactNode }) {
  return (
    <div className="terminal-theme-page p-[var(--terminal-space-page)] text-terminal-text">
      {children}
    </div>
  );
}

export function TerminalEyebrow({
  children,
  tone = "warm",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={joinClasses(
        "terminal-theme-pill terminal-theme-caption inline-flex border px-2.5 py-0.5 text-[9px] uppercase",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}

export function TerminalPanel({
  children,
  elevated = false,
  className,
}: {
  children: ReactNode;
  elevated?: boolean;
  className?: string;
}) {
  return (
    <section
      className={joinClasses(
        "terminal-theme-panel p-[var(--terminal-space-panel)]",
        elevated ? "terminal-theme-panel-elevated" : "",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function TerminalInset({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={joinClasses(
        "terminal-theme-inset p-[var(--terminal-space-inset)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TerminalPanelHeader({
  eyebrow,
  title,
  description,
  meta,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-[var(--terminal-space-section)] flex items-start justify-between gap-3">
      <div className="max-w-3xl">
        {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
        <h2 className="terminal-theme-heading text-[clamp(0.95rem,1.1vw,1.15rem)] font-semibold text-terminal-text">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-[62ch] text-[12px] leading-[1.5] text-terminal-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {meta ? <div className="shrink-0">{meta}</div> : null}
    </div>
  );
}

export function TerminalMetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: Tone;
}) {
  return (
    <div
      className={joinClasses(
        "terminal-theme-card px-[var(--terminal-space-card)] py-[var(--terminal-space-card)]",
        toneClasses[tone],
      )}
    >
      <div className="terminal-theme-caption text-[10px] uppercase">
        {label}
      </div>
      <div className="tnum mt-0.5 text-[14px] font-semibold text-terminal-text">
        {value}
      </div>
      {detail ? (
        <div className="mt-0.5 text-[11px] leading-4 text-terminal-text-secondary">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export function TerminalStatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={joinClasses(
        "terminal-theme-pill terminal-theme-caption inline-flex items-center border px-2.5 py-0.5 text-[9px] uppercase",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}

export function TerminalDivider() {
  return <div className="h-px w-full bg-terminal-border" />;
}

/**
 * Empty states sell the product: show what the panel WILL contain plus one
 * next action — never a blank box.
 *
 * `kicker` is the honest-status eyebrow (e.g. "In development"), `icon` an
 * optional glyph above the title. Props stay `title` / `description` /
 * `action` (existing call sites depend on them).
 */
export function TerminalEmptyState({
  icon,
  kicker,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={joinClasses(
        "terminal-theme-inset flex min-h-[128px] flex-col items-center justify-center px-[var(--terminal-space-panel)] py-[var(--terminal-space-panel)] text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-2 text-terminal-text-muted [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </div>
      ) : null}
      {kicker ? (
        <div className="terminal-theme-caption mb-1.5 text-[10px] uppercase">
          {kicker}
        </div>
      ) : null}
      <div className="text-[15px] font-semibold text-terminal-text">{title}</div>
      {description ? (
        <p className="mt-1.5 max-w-md text-[12px] leading-[1.5] text-terminal-text-secondary">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-3.5">{action}</div> : null}
    </div>
  );
}
