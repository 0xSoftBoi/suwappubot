/**
 * Clipboard Monitor — watches the system clipboard for copied
 * contract addresses (Ethereum and Solana).
 *
 * When detected, fires a callback so the main process can
 * forward it to the webview via RPC.
 */

import { Utils } from "electrobun/bun";

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type DetectedChain = "ethereum" | "solana" | "unknown";

export interface ClipboardDetection {
  address: string;
  chain: DetectedChain;
}

type ClipboardCallback = (detection: ClipboardDetection) => void;

let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastClipboardText = "";
let enabled = true;

const POLL_MS = 1500;
const DEBOUNCE_MS = 3000;
let lastDetectionTime = 0;

function detectAddress(text: string): ClipboardDetection | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 100) return null;

  if (ETH_ADDRESS_RE.test(trimmed)) {
    return { address: trimmed, chain: "ethereum" };
  }

  if (SOLANA_ADDRESS_RE.test(trimmed)) {
    // Additional heuristic: Solana addresses don't start with 0x
    // and are base58 encoded. Filter out obvious non-addresses.
    if (/^[A-Za-z0-9]+$/.test(trimmed) && trimmed.length >= 32) {
      return { address: trimmed, chain: "solana" };
    }
  }

  return null;
}

export function startClipboardMonitor(callback: ClipboardCallback): void {
  if (pollInterval) {
    console.warn("[Clipboard] Monitor already running");
    return;
  }

  // Capture initial clipboard to avoid firing on existing content
  try {
    lastClipboardText = Utils.clipboardReadText() || "";
  } catch {
    lastClipboardText = "";
  }

  pollInterval = setInterval(() => {
    if (!enabled) return;

    try {
      const current = Utils.clipboardReadText() || "";
      if (current === lastClipboardText) return;
      lastClipboardText = current;

      // Debounce
      const now = Date.now();
      if (now - lastDetectionTime < DEBOUNCE_MS) return;

      const detection = detectAddress(current);
      if (detection) {
        lastDetectionTime = now;
        console.log(
          `[Clipboard] Detected ${detection.chain} address: ${detection.address.slice(0, 10)}...`
        );
        callback(detection);
      }
    } catch {
      // Clipboard read can fail if another app has it locked
    }
  }, POLL_MS);

  console.log("[Clipboard] Monitor started");
}

export function stopClipboardMonitor(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log("[Clipboard] Monitor stopped");
  }
}

export function setClipboardMonitorEnabled(value: boolean): void {
  enabled = value;
  console.log(`[Clipboard] Monitor ${value ? "enabled" : "disabled"}`);
}
