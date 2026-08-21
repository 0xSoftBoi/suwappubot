'use client';

import { useState } from 'react';
import { fmt, healthTone } from '@/lib/dapp/format';

export function Card({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card rounded-suwappu-xl p-5 shadow-suwappu-card sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold sm:text-2xl">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-suwappu-text-secondary">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-suwappu-text-secondary">{label}</div>
      {loading ? (
        <div className="mt-1 h-4 w-20 animate-pulse rounded bg-suwappu-sakura-light" />
      ) : (
        <div className="font-mono text-sm font-semibold">{value}</div>
      )}
      {hint && <div className="mt-0.5 text-[11px] text-suwappu-text-secondary">{hint}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-suwappu-sakura-light/70 ${className}`} />;
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary:
      'bg-suwappu-magenta text-white shadow-suwappu-button hover:shadow-suwappu-button-hover disabled:bg-suwappu-text-secondary/40 disabled:shadow-none',
    ghost: 'glass text-suwappu-text hover:bg-white/70 disabled:opacity-50',
    danger: 'bg-red-500 text-white hover:bg-red-600 disabled:opacity-50',
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-suwappu-pill px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/** Amount input with balance, MAX, unit label and inline validation. */
export function TokenInput({
  label,
  value,
  onChange,
  balance,
  decimals = 18,
  symbol,
  error,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  balance?: bigint;
  decimals?: number;
  symbol?: string;
  error?: string | null;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-suwappu-text-secondary">{label}</span>
        {balance !== undefined && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              // formatUnits without locale separators — safe to re-parse.
              const whole = balance / 10n ** BigInt(decimals);
              const frac = balance % 10n ** BigInt(decimals);
              const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
              onChange(fracStr ? `${whole}.${fracStr}` : `${whole}`);
            }}
            className="text-xs text-suwappu-magenta hover:underline disabled:opacity-50"
          >
            Balance: {fmt(balance, decimals)} · MAX
          </button>
        )}
      </div>
      <div
        className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-2 ${
          error ? 'border-red-400' : 'border-suwappu-sakura-mid'
        }`}
      >
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder="0.0"
          disabled={disabled}
          className="w-full bg-transparent font-mono text-sm outline-none disabled:opacity-50"
        />
        {symbol && (
          <span className="shrink-0 text-xs font-semibold text-suwappu-text-secondary">{symbol}</span>
        )}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-suwappu-text-secondary">{hint}</p>
      ) : null}
    </div>
  );
}

/** LTV bar with max-LTV and liquidation markers. */
export function HealthBar({
  ltv,
  maxLtv,
  liqLtv,
}: {
  ltv: bigint | null;
  maxLtv: bigint;
  liqLtv: bigint;
}) {
  const WAD = 10n ** 18n;
  const pct = ltv === null ? 100 : Math.min(100, Number((ltv * 100n) / WAD));
  const maxPct = Math.min(100, Number((maxLtv * 100n) / WAD));
  const liqPct = Math.min(100, Number((liqLtv * 100n) / WAD));
  const tone = healthTone(ltv, maxLtv, liqLtv);
  const color =
    tone === 'safe' ? 'bg-suwappu-success' : tone === 'warn' ? 'bg-suwappu-warning' : 'bg-red-400';
  return (
    <div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-suwappu-sakura-light">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        <span
          className="absolute top-0 h-full w-px bg-suwappu-text-secondary/70"
          style={{ left: `${maxPct}%` }}
          title={`Max LTV ${maxPct}%`}
        />
        <span
          className="absolute top-0 h-full w-px bg-red-500"
          style={{ left: `${liqPct}%` }}
          title={`Liquidation ${liqPct}%`}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-suwappu-text-secondary">
        <span>
          LTV {ltv === null ? '∞' : `${pct.toFixed(1)}%`}
        </span>
        <span>
          max {maxPct}% · liq {liqPct}%
        </span>
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-suwappu-pill px-4 py-2 text-sm font-semibold transition ${
            active === t.id
              ? 'bg-suwappu-magenta text-white shadow-suwappu-button'
              : 'glass text-suwappu-text hover:bg-white/70'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-semibold text-suwappu-magenta hover:underline"
      >
        {open ? 'Hide' : 'Show'} {summary}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-suwappu-sakura-mid bg-white/50 px-4 py-8 text-center">
      <p className="text-sm font-semibold">{title}</p>
      {body && <p className="mt-1 text-xs text-suwappu-text-secondary">{body}</p>}
    </div>
  );
}
