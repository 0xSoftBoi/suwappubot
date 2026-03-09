import { BrowserWindow, Tray, Updater, Utils } from "electrobun/bun";
import Electrobun from "electrobun/bun";
import {
  createMainRPC,
  setTrayUpdateCallback,
  setClipboardDetectionCallback,
  initClipboardFromPreference,
} from "../rpc/handlers";
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from "../native/hotkeys";
import { stopClipboardMonitor } from "../native/clipboard";
import { destroyOverlay, toggleOverlay } from "../native/overlay";
import { setBaseUrl, openWindow, closeAll } from "../native/window-manager";
import { loadAllWindowStates, saveAllNow } from "../native/window-state";
import { createApplicationMenu, destroyApplicationMenu } from "../native/menu";

const DEV_SERVER_PORT = 5174;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// ── Determine content URL ──────────────────────────────────────────────
async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD", signal: AbortSignal.timeout(1000) });
      console.log(`HMR enabled: Using webapp dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log(
        "Webapp dev server not running. Using built assets.\n" +
          "Run 'bun run dev:hmr' for HMR support."
      );
    }
  }
  return "views://mainview/index.html";
}

// ── RPC ────────────────────────────────────────────────────────────────
const rpc = createMainRPC();

// ── Main Window ────────────────────────────────────────────────────────
const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
  title: "Suwappu",
  url,
  rpc,
  frame: {
    width: 1280,
    height: 800,
    x: 100,
    y: 100,
  },
  titleBarStyle: "hiddenInset",
  preload: `
    window.__SUWAPPU_DESKTOP__ = {
      isDesktop: true,
      platform: '${process.platform}',
    };
  `,
});

// ── Window Manager Setup ──────────────────────────────────────────────
setBaseUrl(url);

// Restore previously-open detached panels
const savedStates = await loadAllWindowStates();
for (const state of savedStates) {
  if (state.isOpen) {
    try {
      openWindow(state.id, {
        route: state.route,
        width: state.width,
        height: state.height,
        x: state.x,
        y: state.y,
      });
      console.log(`[Startup] Restored panel: ${state.id}`);
    } catch (err) {
      console.error(`[Startup] Failed to restore panel ${state.id}:`, err);
    }
  }
}

// ── System Tray (Enhanced) ─────────────────────────────────────────────
const tray = new Tray({
  title: "Suwappu",
});

let trayPortfolioValue = "";
let trayAlertCount = 0;
let trayPendingOrders = 0;

function updateTrayMenu() {
  const items: any[] = [
    { type: "normal", label: "Open Suwappu", action: "open" },
    { type: "divider" },
  ];

  // Live portfolio info
  if (trayPortfolioValue) {
    items.push({
      type: "normal",
      label: `Portfolio: ${trayPortfolioValue}`,
      action: "portfolio",
    });
  }
  if (trayAlertCount > 0) {
    items.push({
      type: "normal",
      label: `Alerts: ${trayAlertCount} active`,
      action: "alerts",
    });
  }
  if (trayPendingOrders > 0) {
    items.push({
      type: "normal",
      label: `Pending Orders: ${trayPendingOrders}`,
      action: "orders",
    });
  }
  if (trayPortfolioValue || trayAlertCount > 0 || trayPendingOrders > 0) {
    items.push({ type: "divider" });
  }

  // Quick actions
  items.push(
    { type: "normal", label: "New Swap", action: "swap" },
    { type: "normal", label: "Check Portfolio", action: "portfolio" },
    { type: "normal", label: "Toggle Overlay", action: "toggle-overlay" },
    { type: "divider" },
    { type: "normal", label: "Settings", action: "settings" },
    { type: "normal", label: "Quit", action: "quit" }
  );

  tray.setMenu(items);
}

// Wire up tray updates from webview
setTrayUpdateCallback(({ totalValue, alertCount, pendingOrders }) => {
  trayPortfolioValue = totalValue;
  trayAlertCount = alertCount;
  trayPendingOrders = pendingOrders;

  // Update tray title with portfolio value
  tray.setTitle(totalValue ? `$${totalValue}` : "Suwappu");

  updateTrayMenu();
});

updateTrayMenu();

function focusAndNavigate(path?: string) {
  mainWindow.focus();
  if (path) {
    (mainWindow.webview.rpc as any)?.send?.navigate({ path });
  }
}

tray.on("tray-clicked", (event: any) => {
  const action = event.data?.action;

  const routes: Record<string, string> = {
    swap: "/swap",
    portfolio: "/portfolio",
    alerts: "/alerts",
    orders: "/orders",
    settings: "/settings",
  };

  if (action === "quit") {
    cleanup();
    Utils.quit();
  } else if (action === "toggle-overlay") {
    toggleOverlay();
  } else {
    focusAndNavigate(routes[action]);
  }
});

// ── Global Hotkeys ─────────────────────────────────────────────────────
registerGlobalHotkeys(async (action) => {
  // Panic sell requires explicit confirmation before executing
  if (action === "panic-sell") {
    const confirmed = await Utils.showMessageBox({
      title: "Confirm Panic Sell",
      message: "Emergency sell all positions? This cannot be undone.",
      buttons: ["Cancel", "Sell All"],
      defaultButton: 0,
    });
    if (confirmed !== 1) return; // User did not confirm
  }

  // Forward hotkey events to webview
  (mainWindow.webview.rpc as any)?.send?.["hotkey:triggered"]({ action });

  // Also handle overlay toggle natively
  if (action === "toggle-overlay") {
    toggleOverlay();
  }

  // Navigate to specific pages for toggle actions
  if (action === "toggle-alerts") {
    focusAndNavigate("/alerts");
  }
  if (action === "toggle-copy-trading") {
    focusAndNavigate("/copy");
  }

  // Focus app for search and help actions (webview handles display)
  if (action === "focus-search" || action === "show-hotkey-help") {
    mainWindow.focus();
  }

  // Focus app for actions that need UI
  if (action === "quick-swap" || action === "panic-sell" || action === "quick-search") {
    mainWindow.focus();
  }
});

// ── Clipboard Monitor ──────────────────────────────────────────────────
// Wire clipboard detections to webview + native notification
setClipboardDetectionCallback((detection) => {
  (mainWindow.webview.rpc as any)?.send?.["clipboard:address-detected"]({
    address: detection.address,
    chain: detection.chain,
  });
  Utils.showNotification({
    title: "Address Detected",
    body: `Found ${detection.chain} address in clipboard`,
  });
});

// Load user preference and conditionally start monitor
initClipboardFromPreference();

// ── Application Menu ──────────────────────────────────────────────────
createApplicationMenu({
  onNavigate: (path) => focusAndNavigate(path),
  onToggleOverlay: () => toggleOverlay(),
  onToggleLaunchFeed: () => {
    (mainWindow.webview.rpc as any)?.send?.["hotkey:triggered"]({
      action: "toggle-launch-feed",
    });
    mainWindow.focus();
  },
  onShowHotkeys: () => {
    (mainWindow.webview.rpc as any)?.send?.["hotkey:triggered"]({
      action: "show-hotkey-help",
    });
    mainWindow.focus();
  },
  onQuit: () => {
    cleanup();
    Utils.quit();
  },
});

// ── Deep Links ─────────────────────────────────────────────────────────
Electrobun.events.on("open-url", (e) => {
  const url = new URL(e.data.url);
  const path = url.pathname;
  const params = url.searchParams;

  if (path === "/swap" || url.host === "swap") {
    const from = params.get("from") || "";
    const to = params.get("to") || "";
    const query = from || to ? `?from=${from}&to=${to}` : "";
    focusAndNavigate(`/swap${query}`);
  } else if (path.startsWith("/ref/") || url.host === "ref") {
    const code = path.split("/").pop() || params.get("code") || "";
    focusAndNavigate(`/referrals?code=${code}`);
  } else if (path) {
    // Validate deep link path against allowlist to prevent arbitrary navigation
    const ALLOWED_PATHS = ['/swap', '/wallet', '/portfolio', '/history', '/alerts', '/copy-trade', '/settings', '/referrals', '/home', '/'];
    const isAllowed = ALLOWED_PATHS.some((allowed) => path === allowed || path.startsWith(allowed + '/') || path.startsWith(allowed + '?'));
    focusAndNavigate(isAllowed ? path : '/home');
  }
});

// ── Auto-Updates ───────────────────────────────────────────────────────
async function checkForUpdates() {
  try {
    const updateInfo = await Updater.checkForUpdate();
    if (updateInfo.updateAvailable) {
      console.log(`Update available: ${updateInfo.version}`);
      await Updater.downloadUpdate();
      console.log("Update downloaded and ready to apply.");
    }
  } catch (err) {
    console.error("Update check failed:", err);
  }
}

// Check on launch
checkForUpdates();

// Check every 6 hours
setInterval(checkForUpdates, 6 * 60 * 60 * 1000);

// ── Graceful Shutdown ──────────────────────────────────────────────────
async function cleanup() {
  unregisterGlobalHotkeys();
  destroyApplicationMenu();
  stopClipboardMonitor();
  destroyOverlay();
  await saveAllNow();
  closeAll();
  tray.remove();
}

Electrobun.events.on("before-quit", async () => {
  await cleanup();
});

console.log("Suwappu desktop app started!");
