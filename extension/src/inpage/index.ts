/**
 * Suwappu Wallet Extension — MAIN-world inpage provider entry.
 *
 * This script is injected into every page's MAIN world via the content bridge.
 * It creates window.ethereum (EIP-1193 + EIP-6963) and window.solana,
 * installs the single message router, and guards against double-injection.
 */

import { EthereumProvider } from "./provider";
import { announceEip6963 } from "./eip6963";
import { WALLET_NAMESPACE } from "@/shared/constants";
import type { ContentToInpage } from "@/shared/protocol";

// ──────────────────────────────────────────────────────────────────────────
// Guard: prevent double-injection
// ──────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    ethereum?: unknown;
    solana?: unknown;
    __suwappuWalletInjected?: boolean;
  }
}

if (window.__suwappuWalletInjected) {
  console.warn("[Suwappu] Wallet provider already injected");
} else {
  // ────────────────────────────────────────────────────────────────────────
  // Create and inject EthereumProvider
  // ────────────────────────────────────────────────────────────────────────

  const ethereumProvider = new EthereumProvider();

  // Only set window.ethereum if it's not already a Suwappu provider
  if (
    !window.ethereum ||
    (typeof window.ethereum === "object" &&
      window.ethereum !== null &&
      !("isSuwappu" in window.ethereum))
  ) {
    window.ethereum = ethereumProvider;
  }

  // Announce EIP-6963 provider discovery
  announceEip6963(ethereumProvider);

  // ────────────────────────────────────────────────────────────────────────
  // Register Solana provider (Module B)
  // ────────────────────────────────────────────────────────────────────────

  // Dynamically import registerSolana from Module B.
  // This will create window.solana and register the Wallet Standard.
  // If solana.ts is not yet implemented, this will fail gracefully.
  void import("./solana")
    .then((module) => {
      if (typeof module.registerSolana === "function") {
        module.registerSolana();
      }
    })
    .catch(() => {
      // Solana provider not yet available; EVM provider still works
    });

  // ────────────────────────────────────────────────────────────────────────
  // Single message router: inject both providers
  // ────────────────────────────────────────────────────────────────────────

  window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data;

    // Guard: only process Suwappu wallet messages from inpage context
    if (
      typeof msg === "object" &&
      msg !== null &&
      "namespace" in msg &&
      msg.namespace === WALLET_NAMESPACE &&
      "chain" in msg
    ) {
      const content = msg as ContentToInpage;

      // Route based on chain
      if (content.chain === "eip155") {
        // EVM message: already handled by EthereumProvider's internal listener
        // (This guard is here for completeness; the provider sets up its own listener)
      } else if (content.chain === "solana") {
        // Solana message: route to the Solana provider
        // The Solana provider will have its own message listener set up by registerSolana()
      }
    }
  });

  // Mark as injected to prevent double-injection
  window.__suwappuWalletInjected = true;
}
