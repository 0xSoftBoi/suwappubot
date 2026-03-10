/**
 * Application Menu Bar — native macOS menu for the desktop app.
 *
 * Provides standard Edit menu (undo, redo, cut, copy, paste),
 * view navigation shortcuts, and app-specific actions.
 *
 * Electrobun does not expose a native Menu API, so we use
 * Bun.spawn to invoke an AppleScript-based approach for setting
 * standard menu behavior. For now, we register in-app keyboard
 * shortcuts and provide a callback-based structure that can be
 * wired to a native menu when Electrobun adds support.
 */

import { GlobalShortcut } from "electrobun/bun";

export interface MenuCallbacks {
  onNavigate: (path: string) => void;
  onToggleOverlay: () => void;
  onToggleLaunchFeed: () => void;
  onShowHotkeys: () => void;
  onNewWindow?: () => void;
  onQuit: () => void;
}

interface MenuItem {
  label: string;
  accelerator?: string;
  action?: string;
  role?: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "minimize" | "zoom";
  type?: "separator";
  submenu?: MenuItem[];
}

/**
 * Full menu structure definition. Even though Electrobun doesn't have
 * a native Menu.setApplicationMenu() yet, we define the structure so
 * it can be adopted when the API lands. The keyboard shortcuts are
 * registered via GlobalShortcut as a stopgap.
 */
export const APPLICATION_MENU: MenuItem[] = [
  {
    label: "File",
    submenu: [
      { label: "New Window", accelerator: "Cmd+N", action: "new-window" },
      { label: "Close Window", accelerator: "Cmd+W", action: "close-window" },
      { type: "separator" },
      { label: "Quit", accelerator: "Cmd+Q", action: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { label: "Undo", accelerator: "Cmd+Z", role: "undo" },
      { label: "Redo", accelerator: "Cmd+Shift+Z", role: "redo" },
      { type: "separator" },
      { label: "Cut", accelerator: "Cmd+X", role: "cut" },
      { label: "Copy", accelerator: "Cmd+C", role: "copy" },
      { label: "Paste", accelerator: "Cmd+V", role: "paste" },
      { label: "Select All", accelerator: "Cmd+A", role: "selectAll" },
    ],
  },
  {
    label: "View",
    submenu: [
      { label: "Home", accelerator: "Cmd+1", action: "navigate:/home" },
      { label: "Swap", accelerator: "Cmd+2", action: "navigate:/swap" },
      { label: "Portfolio", accelerator: "Cmd+3", action: "navigate:/portfolio" },
      { label: "Alerts", accelerator: "Cmd+4", action: "navigate:/alerts" },
      { type: "separator" },
      { label: "Toggle Overlay", accelerator: "Cmd+Shift+T", action: "toggle-overlay" },
      { label: "Toggle Launch Feed", accelerator: "Cmd+Shift+L", action: "toggle-launch-feed" },
      { type: "separator" },
      { label: "Reload", accelerator: "Cmd+R", action: "reload" },
    ],
  },
  {
    label: "Window",
    submenu: [
      { label: "Minimize", accelerator: "Cmd+M", role: "minimize" },
      { label: "Zoom", role: "zoom" },
      { type: "separator" },
      { label: "Bring All to Front", action: "bring-all-to-front" },
    ],
  },
  {
    label: "Help",
    submenu: [
      { label: "Keyboard Shortcuts", accelerator: "Cmd+/", action: "show-hotkeys" },
      { label: "Documentation", action: "open-docs" },
      { label: "Release Notes", action: "open-release-notes" },
      { type: "separator" },
      { label: "About Suwappu", action: "about" },
    ],
  },
];

// Track registered accelerators so we can clean up
const registeredAccelerators: string[] = [];

/**
 * Create and activate the application menu.
 *
 * Since Electrobun does not yet have a native Menu API, this registers
 * additional global shortcuts for menu actions that aren't already
 * covered by the hotkeys module (which handles Cmd+Shift combos).
 *
 * Standard Edit shortcuts (Cmd+Z, Cmd+X, Cmd+C, Cmd+V) are handled
 * natively by the webview and don't need explicit registration.
 */
export function createApplicationMenu(callbacks: MenuCallbacks): void {
  const { onNavigate, onToggleOverlay, onToggleLaunchFeed, onShowHotkeys, onQuit } = callbacks;

  // Menu action handlers — only register shortcuts not already handled
  // by the webview (Edit) or the hotkeys module (Cmd+Shift combos)
  const menuShortcuts: Array<{ accelerator: string; handler: () => void }> = [
    {
      // Cmd+/ → Show keyboard shortcuts help
      accelerator: "CmdOrCtrl+/",
      handler: () => {
        console.log("[Menu] Show keyboard shortcuts");
        onShowHotkeys();
      },
    },
  ];

  for (const shortcut of menuShortcuts) {
    try {
      GlobalShortcut.register(shortcut.accelerator, shortcut.handler);
      registeredAccelerators.push(shortcut.accelerator);
    } catch (err) {
      console.error(`[Menu] Failed to register ${shortcut.accelerator}:`, err);
    }
  }

  console.log(`[Menu] Application menu initialized (${registeredAccelerators.length} additional shortcuts registered)`);
}

/**
 * Unregister all menu-specific global shortcuts.
 */
export function destroyApplicationMenu(): void {
  for (const accelerator of registeredAccelerators) {
    try {
      GlobalShortcut.unregister(accelerator);
    } catch {
      // Ignore
    }
  }
  registeredAccelerators.length = 0;
  console.log("[Menu] Application menu destroyed");
}
