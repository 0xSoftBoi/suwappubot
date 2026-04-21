import type { ReactNode } from 'react'

type SummerBreezeStoryFrameProps = {
  eyebrow: string
  title: string
  description: string
  metricLabel?: string
  metricValue?: string
  children: ReactNode
}

export function SummerBreezeStoryFrame({
  eyebrow,
  title,
  description,
  metricLabel,
  metricValue,
  children,
}: SummerBreezeStoryFrameProps) {
  return (
    <div
      className="relative overflow-hidden rounded-[36px] border border-[#E8DEC9] bg-[#FFFDF8] p-6 shadow-[0_24px_80px_rgba(67,43,28,0.08)]"
      style={{
        backgroundImage:
          'radial-gradient(circle_at_10%_12%,rgba(244,218,162,0.28),transparent_20%), radial-gradient(circle_at_90%_16%,rgba(154,218,228,0.18),transparent_22%), linear-gradient(180deg,#FFFEFB_0%,#FFF8ED_100%)',
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#E9D2A5] to-transparent" />

      <div className="relative mb-5 flex items-end justify-between gap-4">
        <div className="max-w-3xl">
          <div className="inline-flex rounded-full border border-[#E8D8B8] bg-white/90 px-3 py-1 text-[10px] uppercase tracking-[0.34em] text-[#A0814F]">
            {eyebrow}
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#2D211A]">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7A6653]">{description}</p>
        </div>
        {metricLabel && metricValue ? (
          <div className="hidden rounded-2xl border border-[#E8D8B8] bg-white/80 px-3 py-2 text-right font-mono text-xs text-[#8E775D] md:block">
            <div className="uppercase tracking-[0.3em]">{metricLabel}</div>
            <div className="mt-1 text-base font-semibold text-[#3A281D]">{metricValue}</div>
          </div>
        ) : null}
      </div>

      <div className="relative">{children}</div>
    </div>
  )
}

type SummerBreezeSurfaceProps = {
  title: string
  description?: string
  meta?: string
  children: ReactNode
}

export function SummerBreezeSurface({
  title,
  description,
  meta,
  children,
}: SummerBreezeSurfaceProps) {
  return (
    <section className="rounded-[28px] border border-[#E7DCC8] bg-white/96 p-4 shadow-[0_10px_30px_rgba(67,43,28,0.05)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#302219]">{title}</h3>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-[#85705A]">{description}</p>
          ) : null}
        </div>
        {meta ? (
          <span className="rounded-full border border-[#ECE0CB] bg-[#FFF9F0] px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-[#8B775F]">
            {meta}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  )
}
