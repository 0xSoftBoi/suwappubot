/**
 * Hotkey Store — persists customizable hotkey bindings to
 * ~/.suwappu/hotkeys.json. Single source of truth for all
 * global keyboard shortcuts.
 */

import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type HotkeyAction =
  | "quick-swap"
  | "panic-sell"
  | "quick-search"
  | "toggle-launch-feed"
  | "toggle-overlay"
  | "toggle-alerts"
  | "toggle-copy-trading"
  | "focus-search"
  | "show-hotkey-help";

export interface HotkeyBinding {
  accelerator: string;
  action: HotkeyAction;
  description: string;
}

const DEFAULT_BINDINGS: HotkeyBinding[] = [
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
  {
    accelerator: "CmdOrCtrl+Shift+A",
    action: "toggle-alerts",
    description: "Toggle alerts panel",
  },
  {
    accelerator: "CmdOrCtrl+Shift+C",
    action: "toggle-copy-trading",
    description: "Toggle copy trading",
  },
  {
    accelerator: "CmdOrCtrl+Shift+F",
    action: "focus-search",
    description: "Focus token search",
  },
  {
    accelerator: "CmdOrCtrl+?",
    action: "show-hotkey-help",
    description: "Show keyboard shortcuts",
  },
];

const SUWAPPU_DIR = join(homedir(), ".suwappu");
const HOTKEYS_FILE = join(SUWAPPU_DIR, "hotkeys.json");

// Valid modifier and key tokens for accelerator format validation
const VALID_MODIFIERS = new Set([
  "Command",
  "Cmd",
  "Control",
  "Ctrl",
  "CmdOrCtrl",
  "CommandOrControl",
  "Alt",
  "Option",
  "AltGr",
  "Shift",
  "Super",
  "Meta",
]);

const VALID_KEYS = new Set([
  // Letters
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  // Numbers
  ..."0123456789".split(""),
  // Function keys
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  // Special keys
  "Plus",
  "Space",
  "Tab",
  "Capslock",
  "Numlock",
  "Scrolllock",
  "Backspace",
  "Delete",
  "Insert",
  "Return",
  "Enter",
  "Up",
  "Down",
  "Left",
  "Right",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Escape",
  "Esc",
  "VolumeUp",
  "VolumeDown",
  "VolumeMute",
  "MediaNextTrack",
  "MediaPreviousTrack",
  "MediaStop",
  "MediaPlayPause",
  // Punctuation
  ")",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ":",
  ";",
  "+",
  "=",
  "<",
  ",",
  "_",
  "-",
  ">",
  ".",
  "?",
  "/",
  "~",
  "`",
  "{",
  "[",
  "|",
  "\\",
  "}",
  "]",
  '"',
  "'",
]);

function ensureDir(): void {
  if (!existsSync(SUWAPPU_DIR)) {
    mkdirSync(SUWAPPU_DIR, { recursive: true });
  }
}

/**
 * Validate accelerator string format (e.g. "CmdOrCtrl+Shift+S").
 * Must have at least one modifier and exactly one key.
 */
export function validateAccelerator(accelerator: string): boolean {
  if (!accelerator || typeof accelerator !== "string") return false;

  const parts = accelerator.split("+");
  if (parts.length < 2) return false;

  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  if (modifiers.length === 0) return false;
  if (!modifiers.every((m) => VALID_MODIFIERS.has(m))) return false;
  if (!VALID_KEYS.has(key)) return false;

  return true;
}

/**
 * Load hotkeys from disk, merging with defaults for any missing actions.
 */
export async function loadHotkeys(): Promise<HotkeyBinding[]> {
  try {
    const file = Bun.file(HOTKEYS_FILE);
    if (await file.exists()) {
      const stored: HotkeyBinding[] = await file.json();

      // Merge: use stored bindings, fill in any missing actions from defaults
      const storedActions = new Set(stored.map((b) => b.action));
      const merged = [...stored];

      for (const def of DEFAULT_BINDINGS) {
        if (!storedActions.has(def.action)) {
          merged.push(def);
        }
      }

      return merged;
    }
  } catch (err) {
    console.error("[HotkeyStore] Failed to load hotkeys, using defaults:", err);
  }

  return [...DEFAULT_BINDINGS];
}

/**
 * Save full bindings array to disk.
 */
export async function saveHotkeys(bindings: HotkeyBinding[]): Promise<void> {
  ensureDir();
  await Bun.write(HOTKEYS_FILE, JSON.stringify(bindings, null, 2));
  console.log(`[HotkeyStore] Saved ${bindings.length} bindings`);
}

/**
 * Reset bindings to defaults.
 */
export async function resetHotkeys(): Promise<HotkeyBinding[]> {
  const defaults = [...DEFAULT_BINDINGS];
  await saveHotkeys(defaults);
  console.log("[HotkeyStore] Reset to defaults");
  return defaults;
}

/**
 * Update a single hotkey binding by action name.
 */
export async function updateHotkey(
  action: string,
  newAccelerator: string
): Promise<boolean> {
  if (!validateAccelerator(newAccelerator)) {
    console.error(
      `[HotkeyStore] Invalid accelerator format: ${newAccelerator}`
    );
    return false;
  }

  const bindings = await loadHotkeys();
  const binding = bindings.find((b) => b.action === action);

  if (!binding) {
    console.error(`[HotkeyStore] Unknown action: ${action}`);
    return false;
  }

  binding.accelerator = newAccelerator;
  await saveHotkeys(bindings);
  return true;
}

/**
 * Get current bindings (loaded from disk or defaults).
 */
export async function getHotkeys(): Promise<HotkeyBinding[]> {
  return await loadHotkeys();
}

export { DEFAULT_BINDINGS };
