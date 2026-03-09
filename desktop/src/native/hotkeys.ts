/**
 * Global Hotkeys — system-wide keyboard shortcuts that work
 * even when the app is not focused.
 *
 * Uses Electrobun's globalShortcut API.
 */

import { GlobalShortcut } from "electrobun/bun";

export type HotkeyAction =
  | "quick-swap"
  | "panic-sell"
  | "quick-search"
  | "toggle-launch-feed"
  | "toggle-overlay";

interface HotkeyBinding {
  accelerator: string;
  action: HotkeyAction;
  description: string;
}

const HOTKEY_BINDINGS: HotkeyBinding[] = [
  {
    accelerator: "CmdOrCtrl+Shift+S",
    action: "quick-swap",
    description: "Open quick swap panel",
  },
  {
    accelerator: "CmdOrCtrl+Shift+P",
    action: "panic-sell",
    description: "Panic sell — emergency sell all positions",
  },
  {
    accelerator: "CmdOrCtrl+Shift+K",
    action: "quick-search",
    description: "Quick token search",
  },
  {
    accelerator: "CmdOrCtrl+Shift+L",
    action: "toggle-launch-feed",
    description: "Toggle launch scanner feed",
  },
  {
    accelerator: "CmdOrCtrl+Shift+T",
    action: "toggle-overlay",
    description: "Toggle always-on-top price ticker",
  },
];

type HotkeyCallback = (action: HotkeyAction) => void;

let registered = false;
let onTrigger: HotkeyCallback | null = null;

export function registerGlobalHotkeys(callback: HotkeyCallback): void {
  if (registered) {
    console.warn("[Hotkeys] Already registered — unregister first");
    return;
  }

  onTrigger = callback;

  for (const binding of HOTKEY_BINDINGS) {
    try {
      GlobalShortcut.register(binding.accelerator, () => {
        console.log(`[Hotkey] ${binding.accelerator} → ${binding.action}`);
        onTrigger?.(binding.action);
      });
    } catch (err) {
      console.error(
        `[Hotkeys] Failed to register ${binding.accelerator}:`,
        err
      );
    }
  }

  registered = true;
  console.log(
    `[Hotkeys] Registered ${HOTKEY_BINDINGS.length} global hotkeys`
  );
}

export function unregisterGlobalHotkeys(): void {
  if (!registered) return;

  for (const binding of HOTKEY_BINDINGS) {
    try {
      GlobalShortcut.unregister(binding.accelerator);
    } catch {
      // Ignore — may not have been registered successfully
    }
  }

  onTrigger = null;
  registered = false;
  console.log("[Hotkeys] Unregistered all global hotkeys");
}

export { HOTKEY_BINDINGS };
