import type { RPCSchema } from "electrobun/bun";

/**
 * RPC schema for communication between the main (Bun) process and the webview.
 *
 * - bun.requests: webview can call these on the main process
 * - bun.messages: webview can send fire-and-forget messages to main
 * - webview.requests: main process can call these on the webview
 * - webview.messages: main process can send fire-and-forget messages to webview
 */
export type DesktopRPC = {
  bun: RPCSchema<{
    requests: {
      // Secure credential storage (OS keychain)
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
      // Native notifications
      "notify:show": {
        params: { title: string; body: string; url?: string };
        response: { success: boolean };
      };
      // Badge count (dock/taskbar)
      "badge:set": {
        params: { count: number };
        response: { success: boolean };
      };
      // File export — save data to local filesystem via native dialog
      "export:save-file": {
        params: {
          filename: string;
          data: string;
          fileType: "csv" | "json" | "pdf";
        };
        response: { success: boolean; path: string | null };
      };
      // Overlay — toggle always-on-top price overlay
      "overlay:toggle": {
        params: {};
        response: { visible: boolean };
      };
      // Tray — update portfolio value shown in system tray
      "tray:update-portfolio": {
        params: {
          totalValue: string;
          alertCount: number;
          pendingOrders: number;
        };
        response: { success: boolean };
      };
      // Overlay — push portfolio positions to the floating overlay
      "overlay:update": {
        params: {
          positions: Array<{
            symbol: string;
            chain: string;
            value: number;
            pnlPercent: number;
          }>;
        };
        response: { success: boolean };
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      // Main process can tell webview to navigate
      navigate: { path: string };
      // Notification was clicked
      "notification:clicked": { url: string };
      // Global hotkey was triggered
      "hotkey:triggered": {
        action:
          | "quick-swap"
          | "panic-sell"
          | "quick-search"
          | "toggle-launch-feed"
          | "toggle-overlay";
      };
      // Clipboard detected a contract address
      "clipboard:address-detected": {
        address: string;
        chain: "ethereum" | "solana" | "unknown";
      };
    };
  }>;
};
