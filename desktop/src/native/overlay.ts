/**
 * Always-On-Top Overlay — minimal floating window showing
 * top token positions with live P&L.
 *
 * Compact horizontal bar, draggable, always-on-top.
 * Click to expand to full app. Toggle via hotkey or tray.
 */

import { BrowserWindow } from "electrobun/bun";

let overlayWindow: BrowserWindow | null = null;
let visible = false;

const OVERLAY_WIDTH = 420;
const OVERLAY_HEIGHT = 160;

function getOverlayHtml(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      background: rgba(15, 10, 25, 0.92);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      overflow: hidden;
      -webkit-app-region: drag;
      user-select: none;
      border-radius: 12px;
    }
    .container {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .title {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #a78bfa;
    }
    .close-btn {
      -webkit-app-region: no-drag;
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      font-size: 16px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .close-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
    .positions {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .position {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      -webkit-app-region: no-drag;
      cursor: pointer;
    }
    .position:hover { background: rgba(255,255,255,0.1); }
    .token-name { font-weight: 600; }
    .token-chain { font-size: 10px; color: #888; }
    .pnl-positive { color: #34d399; font-weight: 600; }
    .pnl-negative { color: #f87171; font-weight: 600; }
    .value { color: #ccc; font-size: 12px; }
    .empty {
      color: #555;
      text-align: center;
      padding: 20px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="title">Suwappu Overlay</span>
      <button class="close-btn" onclick="window.close()" title="Close overlay">x</button>
    </div>
    <div class="positions" id="positions">
      <div class="empty">Waiting for portfolio data...</div>
    </div>
  </div>
  <script>
    function createPositionEl(p) {
      var row = document.createElement('div');
      row.className = 'position';

      var left = document.createElement('div');
      var nameSpan = document.createElement('span');
      nameSpan.className = 'token-name';
      nameSpan.textContent = String(p.symbol);
      var chainSpan = document.createElement('span');
      chainSpan.className = 'token-chain';
      chainSpan.textContent = ' ' + String(p.chain);
      left.appendChild(nameSpan);
      left.appendChild(chainSpan);

      var right = document.createElement('div');
      var pnl = Number(p.pnlPercent) || 0;
      var pnlSpan = document.createElement('span');
      pnlSpan.className = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
      pnlSpan.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(1) + '%';
      var valSpan = document.createElement('span');
      valSpan.className = 'value';
      valSpan.textContent = ' $' + (Number(p.value) || 0).toFixed(2);
      right.appendChild(pnlSpan);
      right.appendChild(valSpan);

      row.appendChild(left);
      row.appendChild(right);
      return row;
    }

    function updatePositions(positions) {
      var el = document.getElementById('positions');
      el.replaceChildren();
      if (!positions || !positions.length) {
        var empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No open positions';
        el.appendChild(empty);
        return;
      }
      positions.slice(0, 5).forEach(function(p) {
        el.appendChild(createPositionEl(p));
      });
    }
  </script>
</body>
</html>`;
}

export function createOverlay(): void {
  if (overlayWindow) return;

  // Position in top-right corner of screen
  overlayWindow = new BrowserWindow({
    title: "Suwappu Overlay",
    url: `data:text/html;charset=utf-8,${encodeURIComponent(getOverlayHtml())}`,
    frame: {
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      x: 100,
      y: 60,
    },
    titleBarStyle: "hidden",
    transparent: true,
  });

  // alwaysOnTop is a method, not a constructor option
  overlayWindow.setAlwaysOnTop(true);

  visible = true;
  console.log("[Overlay] Created");
}

export function toggleOverlay(): boolean {
  if (!overlayWindow) {
    createOverlay();
    return true;
  }

  if (visible) {
    overlayWindow.minimize();
    visible = false;
  } else {
    overlayWindow.unminimize();
    visible = true;
  }

  console.log(`[Overlay] ${visible ? "Shown" : "Hidden"}`);
  return visible;
}

export function destroyOverlay(): void {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
    visible = false;
    console.log("[Overlay] Destroyed");
  }
}

export function isOverlayVisible(): boolean {
  return visible;
}

export interface OverlayPosition {
  symbol: string;
  chain: string;
  value: number;
  pnlPercent: number;
}

export function updateOverlayPositions(positions: OverlayPosition[]): void {
  if (!overlayWindow || !visible) return;

  // Use executeJavascript instead of postMessage (which doesn't exist in Electrobun)
  const positionsJson = JSON.stringify(positions);
  overlayWindow.webview.executeJavascript(
    `updatePositions(${positionsJson})`
  );
}
