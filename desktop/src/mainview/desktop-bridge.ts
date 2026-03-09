/**
 * Desktop bridge — injected into the webview before webapp scripts.
 *
 * Sets up window.__SUWAPPU_DESKTOP__ with RPC-backed secure store
 * and navigation listener for main process -> webview communication.
 *
 * Note: The basic flag (isDesktop, platform) is set via BrowserWindow preload.
 * This script extends it with RPC-backed functionality once Electrobun view is ready.
 */

import { Electroview } from "electrobun/view";

type HotkeyAction =
  | "quick-swap"
  | "panic-sell"
  | "quick-search"
  | "toggle-launch-feed"
  | "toggle-overlay";

type DetectedChain = "ethereum" | "solana" | "unknown";

type DesktopRPC = {
  bun: {
    requests: {
      "store:get": {
        params: { key: string };
        response: { value: string | null };
      };
      "store:set": {
        params: { key: string; value: string };
        response: { success: boolean };
      };
      "store:remove": {
        params: { key: string };
        response: { success: boolean };
      };
      "notify:show": {
        params: { title: string; body: string; url?: string };
        response: { success: boolean };
      };
      "badge:set": {
        params: { count: number };
        response: { success: boolean };
      };
      "export:save-file": {
        params: {
          filename: string;
          data: string;
          fileType: "csv" | "json" | "pdf";
        };
        response: { success: boolean; path: string | null };
      };
      "overlay:toggle": {
        params: {};
        response: { visible: boolean };
      };
      "tray:update-portfolio": {
        params: {
          totalValue: string;
          alertCount: number;
          pendingOrders: number;
        };
        response: { success: boolean };
      };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {
      navigate: { path: string };
      "notification:clicked": { url: string };
      "hotkey:triggered": { action: HotkeyAction };
      "clipboard:address-detected": { address: string; chain: DetectedChain };
    };
  };
};

const rpc = Electroview.defineRPC<DesktopRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {},
    messages: {
      navigate: ({ path }) => {
        window.history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
      "notification:clicked": ({ url }) => {
        window.history.pushState({}, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
      "hotkey:triggered": ({ action }) => {
        window.dispatchEvent(
          new CustomEvent("suwappu:hotkey", { detail: { action } })
        );
      },
      "clipboard:address-detected": ({ address, chain }) => {
        window.dispatchEvent(
          new CustomEvent("suwappu:clipboard-address", {
            detail: { address, chain },
          })
        );
      },
    },
  },
});

const electroview = new Electroview({ rpc });

// Extend the desktop bridge with RPC-backed functionality
const desktopBridge = (window as any).__SUWAPPU_DESKTOP__ || {};

desktopBridge.secureStore = {
  get: async (key: string): Promise<string | null> => {
    const result = await electroview.rpc!.request["store:get"]({ key });
    return result.value;
  },
  set: async (key: string, value: string): Promise<boolean> => {
    const result = await electroview.rpc!.request["store:set"]({ key, value });
    return result.success;
  },
  remove: async (key: string): Promise<boolean> => {
    const result = await electroview.rpc!.request["store:remove"]({ key });
    return result.success;
  },
};

desktopBridge.notify = async (
  title: string,
  body: string,
  url?: string
): Promise<boolean> => {
  const result = await electroview.rpc!.request["notify:show"]({
    title,
    body,
    url,
  });
  return result.success;
};

desktopBridge.setBadge = async (count: number): Promise<boolean> => {
  const result = await electroview.rpc!.request["badge:set"]({ count });
  return result.success;
};

desktopBridge.exportFile = async (
  filename: string,
  data: string,
  fileType: "csv" | "json" | "pdf"
): Promise<{ success: boolean; path: string | null }> => {
  return await electroview.rpc!.request["export:save-file"]({
    filename,
    data,
    fileType,
  });
};

desktopBridge.toggleOverlay = async (): Promise<boolean> => {
  const result = await electroview.rpc!.request["overlay:toggle"]({});
  return result.visible;
};

desktopBridge.updateTrayPortfolio = async (
  totalValue: string,
  alertCount: number,
  pendingOrders: number
): Promise<boolean> => {
  const result = await electroview.rpc!.request["tray:update-portfolio"]({
    totalValue,
    alertCount,
    pendingOrders,
  });
  return result.success;
};

(window as any).__SUWAPPU_DESKTOP__ = desktopBridge;
