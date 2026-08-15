import { defineManifest } from "@crxjs/vite-plugin";

// MV3 manifest. The content script runs in the ISOLATED world and injects
// src/inpage/index.ts into the MAIN world via a <script> tag pointing at a
// web-accessible resource (so the dApp page sees window.ethereum/window.solana).
export default defineManifest({
  manifest_version: 3,
  name: "Suwappu Wallet",
  version: "0.1.0",
  description:
    "Non-custodial cross-chain wallet — injected EIP-1193/EIP-6963 + Solana Wallet Standard, passkey-secured (PRF) vault with KMS backup.",
  action: {
    default_popup: "index.html",
    default_title: "Suwappu Wallet",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content/bridge.ts"],
      run_at: "document_start",
      all_frames: false,
    },
  ],
  web_accessible_resources: [
    {
      resources: ["src/inpage/index.ts", "assets/*"],
      matches: ["http://*/*", "https://*/*"],
    },
  ],
  permissions: ["storage", "tabs", "notifications"],
  host_permissions: ["http://*/*", "https://*/*"],
  // Required so chrome.storage.session can be read from the offscreen/popup
  // trusted contexts; access level is set at runtime to TRUSTED_CONTEXTS.
  minimum_chrome_version: "132",
});
