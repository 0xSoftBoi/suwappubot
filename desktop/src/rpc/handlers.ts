import { BrowserView, Utils } from "electrobun/bun";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { DesktopRPC } from "./types";
import { exportFile } from "../native/export";
import { toggleOverlay, updateOverlayPositions, type OverlayPosition } from "../native/overlay";

// File-backed secure store — persists across app restarts
// Stored at ~/.suwappu/store.json (replace with OS keychain in production)
const STORE_DIR = join(homedir(), ".suwappu");
const STORE_PATH = join(STORE_DIR, "store.json");

function loadStore(): Map<string, string> {
  try {
    if (existsSync(STORE_PATH)) {
      const data = JSON.parse(require("node:fs").readFileSync(STORE_PATH, "utf-8"));
      return new Map(Object.entries(data));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return new Map();
}

function saveStore(store: Map<string, string>): void {
  try {
    if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
    const obj = Object.fromEntries(store);
    Bun.write(STORE_PATH, JSON.stringify(obj));
  } catch (err) {
    console.error("[Store] Failed to save:", err);
  }
}

const secureStore = loadStore();

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
        "store:get": ({ key }) => {
          return { value: secureStore.get(key) ?? null };
        },
        "store:set": ({ key, value }) => {
          secureStore.set(key, value);
          saveStore(secureStore);
          return { success: true };
        },
        "store:remove": ({ key }) => {
          secureStore.delete(key);
          saveStore(secureStore);
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
        "overlay:update": ({ positions }) => {
          updateOverlayPositions(positions as OverlayPosition[]);
          return { success: true };
        },
      },
      messages: {},
    },
  });
}
