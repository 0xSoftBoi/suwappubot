/**
 * Window State Persistence — save and restore window geometry
 * across app restarts.
 *
 * Stores window state to ~/.suwappu/window-state.json using Bun I/O.
 * Debounces saves to avoid excessive writes from move/resize events.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isOpen: boolean;
  route: string;
}

type StateMap = Record<string, WindowState>;

const SUWAPPU_DIR = join(homedir(), ".suwappu");
const STATE_FILE = join(SUWAPPU_DIR, "window-state.json");

let stateCache: StateMap = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

function ensureDir(): void {
  if (!existsSync(SUWAPPU_DIR)) {
    mkdirSync(SUWAPPU_DIR, { recursive: true });
  }
}

async function flushToDisk(): Promise<void> {
  try {
    ensureDir();
    await Bun.write(STATE_FILE, JSON.stringify(stateCache, null, 2));
  } catch (err) {
    console.error("[WindowState] Failed to save:", err);
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushToDisk();
    saveTimer = null;
  }, DEBOUNCE_MS);
}

export function saveWindowState(
  id: string,
  bounds: WindowBounds,
  route: string,
  isOpen: boolean
): void {
  stateCache[id] = {
    id,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isOpen,
    route,
  };
  scheduleSave();
}

export function markWindowClosed(id: string): void {
  if (stateCache[id]) {
    stateCache[id].isOpen = false;
    scheduleSave();
  }
}

export async function loadAllWindowStates(): Promise<WindowState[]> {
  try {
    const file = Bun.file(STATE_FILE);
    if (!(await file.exists())) return [];

    const text = await file.text();
    stateCache = JSON.parse(text) as StateMap;
    return Object.values(stateCache);
  } catch (err) {
    console.error("[WindowState] Failed to load:", err);
    stateCache = {};
    return [];
  }
}

export function clearWindowState(id: string): void {
  delete stateCache[id];
  scheduleSave();
}

/** Force an immediate save (e.g., on shutdown). */
export async function saveAllNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await flushToDisk();
}
