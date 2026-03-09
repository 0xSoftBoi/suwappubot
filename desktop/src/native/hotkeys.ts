/**
 * Global Hotkeys — system-wide keyboard shortcuts that work
 * even when the app is not focused.
 *
 * Uses Electrobun's globalShortcut API.
 * Bindings are loaded dynamically from hotkey-store.
 */

import { GlobalShortcut } from "electrobun/bun";
import {
  getHotkeys,
  type HotkeyAction,
  type HotkeyBinding,
} from "./hotkey-store";

export type { HotkeyAction, HotkeyBinding };

type HotkeyCallback = (action: HotkeyAction) => void;

let registered = false;
let currentBindings: HotkeyBinding[] = [];
let onTrigger: HotkeyCallback | null = null;

export async function registerGlobalHotkeys(
  callback: HotkeyCallback
): Promise<void> {
  if (registered) {
    console.warn("[Hotkeys] Already registered — unregister first");
    return;
  }

  onTrigger = callback;
  currentBindings = await getHotkeys();

  for (const binding of currentBindings) {
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
    `[Hotkeys] Registered ${currentBindings.length} global hotkeys`
  );
}

export function unregisterGlobalHotkeys(): void {
  if (!registered) return;

  for (const binding of currentBindings) {
    try {
      GlobalShortcut.unregister(binding.accelerator);
    } catch {
      // Ignore — may not have been registered successfully
    }
  }

  onTrigger = null;
  currentBindings = [];
  registered = false;
  console.log("[Hotkeys] Unregistered all global hotkeys");
}

/**
 * Re-register all hotkeys — unregister current, reload from store,
 * re-register. Used when the user changes bindings at runtime.
 */
export async function reregisterGlobalHotkeys(): Promise<void> {
  const callback = onTrigger;
  unregisterGlobalHotkeys();
  if (callback) {
    await registerGlobalHotkeys(callback);
  }
}

export { currentBindings as HOTKEY_BINDINGS };
