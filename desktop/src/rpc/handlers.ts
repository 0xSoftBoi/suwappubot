import { BrowserView, Utils } from "electrobun/bun";
import type { DesktopRPC } from "./types";
import { exportFile } from "../native/export";
import { toggleOverlay } from "../native/overlay";
import {
  openWindow,
  closeWindow,
  listWindows,
} from "../native/window-manager";
import {
  getHotkeys,
  updateHotkey,
  resetHotkeys,
} from "../native/hotkey-store";
import { reregisterGlobalHotkeys } from "../native/hotkeys";
import {
  startClipboardMonitor,
  stopClipboardMonitor,
  setClipboardMonitorEnabled,
} from "../native/clipboard";
import { secureGet, secureSet, secureRemove, migrateFromMap } from "../native/keychain";

// Legacy in-memory store — kept for migration from older sessions
const legacyStore = new Map<string, string>();
let migrationDone = false;

async function ensureMigrated(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  if (legacyStore.size > 0) {
    await migrateFromMap(legacyStore);
    legacyStore.clear();
  }
}

// Clipboard monitoring state
let clipboardEnabled = false;
let clipboardMonitorStarted = false;
let clipboardDetectionCallback: ((detection: { address: string; chain: string }) => void) | null = null;

export function setClipboardDetectionCallback(
  callback: (detection: { address: string; chain: string }) => void
) {
  clipboardDetectionCallback = callback;
}

export async function initClipboardFromPreference() {
  await ensureMigrated();
  const stored = await secureGet("clipboard-enabled");
  if (stored === "true") {
    clipboardEnabled = true;
    startClipboardIfNeeded();
  }
}

function startClipboardIfNeeded() {
  if (clipboardEnabled && !clipboardMonitorStarted) {
    startClipboardMonitor((detection) => {
      clipboardDetectionCallback?.(detection);
    });
    clipboardMonitorStarted = true;
  }
  setClipboardMonitorEnabled(clipboardEnabled);
}

function stopClipboardIfRunning() {
  if (clipboardMonitorStarted) {
    stopClipboardMonitor();
    clipboardMonitorStarted = false;
  }
}

// Tray state — shared with main process via callback
let onTrayUpdate: ((data: { totalValue: string; alertCount: number; pendingOrders: number }) => void) | null = null;

export function setTrayUpdateCallback(
  callback: (data: { totalValue: string; alertCount: number; pendingOrders: number }) => void
) {
  onTrayUpdate = callback;
}

export function createMainRPC() {
  return BrowserView.defineRPC<DesktopRPC>({
    maxRequestTime: 5000,
    handlers: {
      requests: {
        "store:get": async ({ key }) => {
          await ensureMigrated();
          const value = await secureGet(key);
          return { value };
        },
        "store:set": async ({ key, value }) => {
          await ensureMigrated();
          await secureSet(key, value);
          return { success: true };
        },
        "store:remove": async ({ key }) => {
          await ensureMigrated();
          await secureRemove(key);
          return { success: true };
        },
        "notify:show": ({ title, body }) => {
          Utils.showNotification({ title, body });
          return { success: true };
        },
        "badge:set": ({ count }) => {
          // TODO: Electrobun does not yet expose a setBadgeCount API — track upstream
          console.log(`[Badge] Set to ${count}`);
          return { success: true };
        },
        "export:save-file": async ({ filename, data, fileType }) => {
          return await exportFile({ filename, data, fileType });
        },
        "overlay:toggle": () => {
          const visible = toggleOverlay();
          return { visible };
        },
        "tray:update-portfolio": ({ totalValue, alertCount, pendingOrders }) => {
          onTrayUpdate?.({ totalValue, alertCount, pendingOrders });
          return { success: true };
        },
        "window:open": ({ id, route, width, height }) => {
          return openWindow(id, { route, width, height });
        },
        "window:close": ({ id }) => {
          const closed = closeWindow(id);
          return { success: closed };
        },
        "window:list": () => {
          return { windows: listWindows() };
        },
        "hotkeys:list": async () => {
          const bindings = await getHotkeys();
          return { bindings };
        },
        "hotkeys:update": async ({ action, accelerator }) => {
          const success = await updateHotkey(action, accelerator);
          if (success) {
            await reregisterGlobalHotkeys();
          }
          return { success };
        },
        "hotkeys:reset": async () => {
          const bindings = await resetHotkeys();
          await reregisterGlobalHotkeys();
          return { bindings };
        },
        "clipboard:set-enabled": async ({ enabled }) => {
          clipboardEnabled = enabled;
          await secureSet("clipboard-enabled", String(enabled));
          if (enabled) {
            startClipboardIfNeeded();
          } else {
            setClipboardMonitorEnabled(false);
            stopClipboardIfRunning();
          }
          return { success: true };
        },
        "clipboard:get-enabled": () => {
          return { enabled: clipboardEnabled };
        },
      },
      messages: {},
    },
  });
}
