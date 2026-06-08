import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-[11px]",
  md: "px-3 py-1.5 text-[12px]",
};

const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: "terminal-button text-white",
  secondary: "terminal-button-secondary",
  ghost:
    "rounded-[var(--terminal-radius-control)] border border-transparent bg-transparent text-terminal-text-secondary transition-colors hover:border-terminal-border hover:bg-terminal-bg-secondary hover:text-terminal-text active:scale-[0.98]",
};

export function TerminalButton({
  children,
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={joinClasses(
        buttonVariantClasses[variant],
        buttonSizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TerminalIconButton({
  className,
  label,
  children,
  active = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      className={joinClasses(
        "terminal-theme-control inline-flex h-7 w-7 items-center justify-center text-terminal-text-secondary active:scale-[0.98]",
        active
          ? "terminal-theme-control-active text-terminal-text"
          : "hover:text-terminal-text",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TerminalKeyHint({ children }: { children: ReactNode }) {
  return (
    <kbd className="terminal-theme-control rounded-[var(--terminal-radius-card)] px-2 py-0.5 font-mono text-[10px] text-terminal-text-muted">
      {children}
    </kbd>
  );
}

export function TerminalTextField({
  className,
  label,
  prefix,
  suffix,
  mono = false,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  label?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  mono?: boolean;
}) {
  return (
    <label className="grid gap-0.5">
      {label ? (
        <span className="terminal-theme-caption text-[9px] uppercase text-terminal-text-muted">
          {label}
        </span>
      ) : null}
      <div className="terminal-theme-control flex items-center gap-1.5 px-2.5 py-1">
        {prefix ? (
          <span className="shrink-0 text-terminal-text-muted">{prefix}</span>
        ) : null}
        <input
          className={joinClasses(
            "min-w-0 flex-1 bg-transparent text-terminal-text placeholder-terminal-text-muted outline-none",
            mono ? "font-mono text-[13px]" : "text-[13px]",
            className,
          )}
          {...props}
        />
        {suffix ? <span className="shrink-0">{suffix}</span> : null}
      </div>
    </label>
  );
}

type TerminalTabOption = {
  id: string;
  label: string;
  meta?: string;
};

export function TerminalSegmentedTabs({
  activeId,
  options,
  onChange,
}: {
  activeId: string;
  options: TerminalTabOption[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="terminal-theme-inset inline-flex flex-wrap items-stretch gap-0.5 p-0.5">
      {options.map((option) => {
        const active = option.id === activeId;

        return (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            className={joinClasses(
              "terminal-theme-control min-h-[36px] rounded-[var(--terminal-radius-card)] px-2.5 py-1 text-left transition-colors hover:translate-y-0 focus:translate-y-0",
              active
                ? "terminal-theme-control-active text-terminal-text"
                : "text-terminal-text-secondary hover:text-terminal-text",
            )}
          >
            <div className="text-[13px] font-medium leading-[1.05]">
              {option.label}
            </div>
            {option.meta ? (
              <div className="terminal-theme-caption mt-0.5 text-[9px] uppercase leading-none opacity-70">
                {option.meta}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TerminalSelectPill({
  label,
  detail,
  active = false,
  onClick,
  leading,
}: {
  label: string;
  detail?: string;
  active?: boolean;
  onClick?: () => void;
  leading?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={joinClasses(
        "terminal-theme-pill inline-flex items-center gap-2 border px-2.5 py-1 text-left transition-colors active:scale-[0.98]",
        active
          ? "border-terminal-border-active bg-white text-terminal-text [box-shadow:var(--terminal-shadow-raised)]"
          : "border-terminal-border bg-terminal-bg-secondary text-terminal-text-secondary hover:bg-white hover:text-terminal-text",
      )}
    >
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        {detail ? (
          <span className="terminal-theme-caption block text-[9px] uppercase opacity-70">
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function TerminalTokenPill({
  symbol,
  label,
  tone = "neutral",
}: {
  symbol: string;
  label?: string;
  tone?: "neutral" | "warm" | "sky";
}) {
  const toneClasses =
    tone === "warm"
      ? "border-sakura-300 bg-sakura-50"
      : tone === "sky"
        ? "border-chain-solana/20 bg-chain-solana/5"
        : "border-terminal-border bg-terminal-bg-secondary";

  return (
    <span
      className={joinClasses(
        "terminal-theme-pill inline-flex items-center gap-2 border px-2.5 py-1",
        toneClasses,
      )}
    >
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/70 bg-white font-mono text-[9px] font-semibold text-terminal-text shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {symbol.slice(0, 2)}
      </span>
      <span>
        <span className="block text-[11px] font-semibold text-terminal-text">
          {symbol}
        </span>
        {label ? (
          <span className="block text-[9px] text-terminal-text-muted">
            {label}
          </span>
        ) : null}
      </span>
    </span>
  );
}
