'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_DEADLINE_MINUTES, DEFAULT_SLIPPAGE_BPS } from '@/lib/dapp/config';
import { Button } from './ui';

interface Settings {
  slippageBps: number;
  deadlineMinutes: number;
  setSlippageBps: (v: number) => void;
  setDeadlineMinutes: (v: number) => void;
}

const Ctx = createContext<Settings | null>(null);
const KEY = 'suwappu.dapp.settings';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [slippageBps, setSlippage] = useState(DEFAULT_SLIPPAGE_BPS);
  const [deadlineMinutes, setDeadline] = useState(DEFAULT_DEADLINE_MINUTES);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (typeof p.slippageBps === 'number') setSlippage(p.slippageBps);
      if (typeof p.deadlineMinutes === 'number') setDeadline(p.deadlineMinutes);
    } catch {}
  }, []);

  const persist = useCallback((s: number, d: number) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ slippageBps: s, deadlineMinutes: d }));
    } catch {}
  }, []);

  const setSlippageBps = useCallback(
    (v: number) => {
      const clamped = Math.min(5000, Math.max(1, Math.round(v)));
      setSlippage(clamped);
      persist(clamped, deadlineMinutes);
    },
    [deadlineMinutes, persist],
  );

  const setDeadlineMinutes = useCallback(
    (v: number) => {
      const clamped = Math.min(180, Math.max(1, Math.round(v)));
      setDeadline(clamped);
      persist(slippageBps, clamped);
    },
    [slippageBps, persist],
  );

  const value = useMemo(
    () => ({ slippageBps, deadlineMinutes, setSlippageBps, setDeadlineMinutes }),
    [slippageBps, deadlineMinutes, setSlippageBps, setDeadlineMinutes],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings must be used inside <SettingsProvider>');
  return v;
}

const SLIPPAGE_PRESETS = [10, 50, 100];

export function SettingsPopover() {
  const { slippageBps, deadlineMinutes, setSlippageBps, setDeadlineMinutes } = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        ⚙ {(slippageBps / 100).toFixed(2)}%
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-suwappu-xl border border-suwappu-sakura-mid bg-white p-4 shadow-suwappu-card">
          <h4 className="text-sm font-bold">Transaction settings</h4>

          <div className="mt-3">
            <label className="text-xs font-semibold text-suwappu-text-secondary">
              Slippage tolerance
            </label>
            <div className="mt-1 flex items-center gap-2">
              {SLIPPAGE_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSlippageBps(p)}
                  className={`rounded-suwappu-pill px-3 py-1 text-xs font-semibold ${
                    slippageBps === p
                      ? 'bg-suwappu-magenta text-white'
                      : 'bg-suwappu-blush text-suwappu-text'
                  }`}
                >
                  {p / 100}%
                </button>
              ))}
              <input
                type="number"
                min={0.01}
                max={50}
                step={0.01}
                value={(slippageBps / 100).toString()}
                onChange={(e) => setSlippageBps(Number(e.target.value) * 100)}
                className="w-20 rounded-lg border border-suwappu-sakura-mid px-2 py-1 font-mono text-xs"
                aria-label="Custom slippage percent"
              />
            </div>
            {slippageBps > 300 && (
              <p className="mt-1 text-[11px] text-amber-600">
                High slippage — you may get a materially worse price.
              </p>
            )}
          </div>

          <div className="mt-3">
            <label className="text-xs font-semibold text-suwappu-text-secondary">
              Transaction deadline
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={180}
                value={deadlineMinutes}
                onChange={(e) => setDeadlineMinutes(Number(e.target.value))}
                className="w-20 rounded-lg border border-suwappu-sakura-mid px-2 py-1 font-mono text-xs"
                aria-label="Deadline in minutes"
              />
              <span className="text-xs text-suwappu-text-secondary">minutes</span>
            </div>
            <p className="mt-1 text-[11px] text-suwappu-text-secondary">
              The contracts enforce this on-chain — it bounds validator tx-withholding (MEV).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
