import type { ReactNode } from "react";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type Tone = "neutral" | "warm" | "sky";

const toneClasses: Record<Tone, string> = {
  neutral:
    "border-terminal-border bg-terminal-bg-secondary text-terminal-text-secondary",
  warm: "border-sakura-300 bg-sakura-50 text-sakura-700",
  sky: "border-chain-solana/20 bg-chain-solana/5 text-chain-solana",
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
        "terminal-theme-pill terminal-theme-caption inline-flex border px-3 py-1 text-[10px] uppercase",
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
        <h2 className="terminal-theme-heading text-[clamp(1.65rem,2vw,2.1rem)] font-semibold text-terminal-text">
          {title}
        </h2>
        {description ? (
          <p className="mt-1.5 max-w-[62ch] text-sm leading-6 text-terminal-text-secondary">
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
      <div className="mt-1 text-[15px] font-semibold text-terminal-text">
        {value}
      </div>
      {detail ? (
        <div className="mt-1 text-xs text-terminal-text-secondary">
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
        "terminal-theme-pill terminal-theme-caption inline-flex items-center border px-2.5 py-1 text-[10px] uppercase",
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

export function TerminalEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="terminal-theme-inset flex min-h-[160px] flex-col items-center justify-center border-dashed px-[var(--terminal-space-panel)] text-center">
      <div className="text-base font-semibold text-terminal-text">{title}</div>
      <p className="mt-2 max-w-md text-sm leading-6 text-terminal-text-secondary">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
