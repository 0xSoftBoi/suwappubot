import { BrowserView, Utils } from "electrobun/bun";
import type { DesktopRPC } from "./types";
import { exportFile } from "../native/export";
import { toggleOverlay } from "../native/overlay";

// In-memory secure store (placeholder — replace with OS keychain integration)
const secureStore = new Map<string, string>();

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
          return { success: true };
        },
        "store:remove": ({ key }) => {
          secureStore.delete(key);
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
      },
      messages: {},
    },
  });
}
