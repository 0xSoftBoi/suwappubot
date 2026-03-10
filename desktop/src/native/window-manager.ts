/**
 * Window Manager — central registry for detachable panel windows.
 *
 * Each panel (chart, portfolio, order-book, alerts, copy-trading)
 * can be popped out into its own BrowserWindow. The manager tracks
 * all open windows and wires their move/resize events to state
 * persistence.
 */

import { BrowserWindow } from "electrobun/bun";
import {
  saveWindowState,
  markWindowClosed,
  type WindowBounds,
} from "./window-state";

export type PanelId =
  | "chart"
  | "portfolio"
  | "order-book"
  | "alerts"
  | "copy-trading";

export interface PanelConfig {
  route: string;
  width: number;
  height: number;
  title: string;
}

const DEFAULT_CONFIGS: Record<PanelId, PanelConfig> = {
  chart: { route: "/swap", width: 800, height: 600, title: "Chart" },
  portfolio: { route: "/portfolio", width: 600, height: 800, title: "Portfolio" },
  "order-book": { route: "/orders", width: 400, height: 600, title: "Order Book" },
  alerts: { route: "/alerts", width: 500, height: 600, title: "Alerts" },
  "copy-trading": { route: "/copy", width: 600, height: 700, title: "Copy Trading" },
};

interface ManagedWindow {
  window: BrowserWindow;
  config: PanelConfig;
}

const windows = new Map<string, ManagedWindow>();

/** Base URL resolver — set once from the main process at startup. */
let baseUrl = "views://mainview/index.html";

export function setBaseUrl(url: string): void {
  baseUrl = url;
}

function buildPanelUrl(route: string): string {
  // For dev server URLs, append the route path + detached flag
  if (baseUrl.startsWith("http")) {
    const url = new URL(baseUrl);
    url.pathname = route;
    url.searchParams.set("isDetached", "true");
    return url.toString();
  }
  // For built assets (views:// protocol), use query params
  return `${baseUrl}?route=${encodeURIComponent(route)}&isDetached=true`;
}

export function openWindow(
  id: string,
  options?: {
    route?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  }
): { id: string; route: string; bounds: WindowBounds } {
  // If already open, focus and return
  const existing = windows.get(id);
  if (existing) {
    existing.window.focus();
    return {
      id,
      route: existing.config.route,
      bounds: {
        x: 0,
        y: 0,
        width: existing.config.width,
        height: existing.config.height,
      },
    };
  }

  const defaults = DEFAULT_CONFIGS[id as PanelId];
  const route = options?.route ?? defaults?.route ?? `/${id}`;
  const width = options?.width ?? defaults?.width ?? 600;
  const height = options?.height ?? defaults?.height ?? 600;
  const title = defaults?.title ?? id;

  const config: PanelConfig = { route, width, height, title };
  const url = buildPanelUrl(route);

  const frame: { width: number; height: number; x?: number; y?: number } = {
    width,
    height,
  };
  if (options?.x !== undefined && options?.y !== undefined) {
    frame.x = options.x;
    frame.y = options.y;
  }

  const win = new BrowserWindow({
    title: `Suwappu — ${title}`,
    url,
    frame,
    titleBarStyle: "hiddenInset",
    preload: `
      window.__SUWAPPU_DESKTOP__ = {
        isDesktop: true,
        isDetached: true,
        panelId: '${id}',
        platform: '${process.platform}',
      };
    `,
  });

  windows.set(id, { window: win, config });

  // Persist initial state
  saveWindowState(
    id,
    { x: frame.x ?? 0, y: frame.y ?? 0, width, height },
    route,
    true
  );

  // Track window close
  win.on("closed", () => {
    windows.delete(id);
    markWindowClosed(id);
    console.log(`[WindowManager] Panel closed: ${id}`);
  });

  // Track move/resize for state persistence
  win.on("moved", (event: any) => {
    const bounds = event?.data ?? { x: 0, y: 0, width, height };
    saveWindowState(id, bounds, route, true);
  });

  win.on("resized", (event: any) => {
    const bounds = event?.data ?? { x: 0, y: 0, width, height };
    saveWindowState(id, bounds, route, true);
  });

  console.log(`[WindowManager] Opened panel: ${id} → ${route}`);

  return {
    id,
    route,
    bounds: { x: frame.x ?? 0, y: frame.y ?? 0, width, height },
  };
}

export function closeWindow(id: string): boolean {
  const managed = windows.get(id);
  if (!managed) return false;

  managed.window.close();
  windows.delete(id);
  markWindowClosed(id);
  console.log(`[WindowManager] Closed panel: ${id}`);
  return true;
}

export function getWindow(id: string): BrowserWindow | null {
  return windows.get(id)?.window ?? null;
}

export function listWindows(): Array<{
  id: string;
  route: string;
  bounds: { width: number; height: number };
}> {
  return Array.from(windows.entries()).map(([id, { config }]) => ({
    id,
    route: config.route,
    bounds: { width: config.width, height: config.height },
  }));
}

export function closeAll(): void {
  for (const [id, { window: win }] of windows) {
    try {
      win.close();
      markWindowClosed(id);
    } catch {
      // Window may already be closed
    }
  }
  windows.clear();
  console.log("[WindowManager] All panels closed");
}
