import type { ReactNode } from "react";

type SummerBreezeStoryFrameProps = {
  eyebrow: string;
  title: string;
  description: string;
  metricLabel?: string;
  metricValue?: string;
  children: ReactNode;
};

export function SummerBreezeStoryFrame({
  eyebrow,
  title,
  description,
  metricLabel,
  metricValue,
  children,
}: SummerBreezeStoryFrameProps) {
  return (
    <div className="terminal-theme-panel terminal-theme-panel-elevated relative overflow-hidden p-[var(--terminal-space-page)]">
      <div className="pointer-events-none absolute -left-10 top-[-72px] h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(244,218,162,0.42)_0%,rgba(244,218,162,0)_72%)] blur-2xl" />
      <div className="pointer-events-none absolute right-[-54px] top-10 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(154,218,228,0.34)_0%,rgba(154,218,228,0)_72%)] blur-2xl" />
      <div className="pointer-events-none absolute bottom-[-80px] left-1/3 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(244,201,99,0.24)_0%,rgba(244,201,99,0)_74%)] blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#E9D2A5] to-transparent" />

      <div className="relative z-10 mb-[var(--terminal-space-section)] flex items-end justify-between gap-3">
        <div className="max-w-3xl">
          <div className="terminal-theme-pill terminal-theme-caption inline-flex border border-[#E8D8B8] bg-white/90 px-3 py-1 text-[10px] uppercase text-[#8F7652]">
            {eyebrow}
          </div>
          <h2 className="terminal-theme-heading mt-2.5 text-[clamp(1.7rem,2vw,2.25rem)] font-semibold text-[#2D211A]">
            {title}
          </h2>
          <p className="mt-1.5 max-w-[62ch] text-sm leading-6 text-[#6F604D]">
            {description}
          </p>
        </div>
        {metricLabel && metricValue ? (
          <div className="terminal-theme-card hidden px-[var(--terminal-space-card)] py-[var(--terminal-space-card)] text-right font-mono text-xs text-[#8E775D] md:block">
            <div className="terminal-theme-caption uppercase">
              {metricLabel}
            </div>
            <div className="mt-1 text-sm font-semibold text-[#3A281D]">
              {metricValue}
            </div>
          </div>
        ) : null}
      </div>

      <div className="relative z-10">{children}</div>
    </div>
  );
}

type SummerBreezeSurfaceProps = {
  title: string;
  description?: string;
  meta?: string;
  children: ReactNode;
};

export function SummerBreezeSurface({
  title,
  description,
  meta,
  children,
}: SummerBreezeSurfaceProps) {
  return (
    <section className="terminal-theme-card p-[var(--terminal-space-panel)]">
      <div className="mb-[var(--terminal-space-section)] flex items-start justify-between gap-3">
        <div>
          <h3 className="terminal-theme-heading text-sm font-semibold text-[#302219]">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-[#85705A]">
              {description}
            </p>
          ) : null}
        </div>
        {meta ? (
          <span className="terminal-theme-pill terminal-theme-caption border border-[#ECE0CB] bg-[#FFF9F0] px-2.5 py-1 text-[10px] uppercase text-[#8B775F]">
            {meta}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
