import { PROVIDER_INFO } from "@/shared/constants";
import type { EthereumProvider } from "./provider";

/**
 * EIP-6963 provider discovery announcement.
 * Dispatches 'eip6963:announceProvider' CustomEvent with provider details.
 * Re-announces on 'eip6963:requestProvider' from dApps.
 */
export function announceEip6963(provider: EthereumProvider): void {
  // Create the announcement event payload
  const detail = Object.freeze({
    info: PROVIDER_INFO,
    provider,
  });

  // Dispatch initial announcement
  dispatchAnnouncement(detail);

  // Listen for request announcements from dApps and re-announce
  window.addEventListener("eip6963:requestProvider", () => {
    dispatchAnnouncement(detail);
  });
}

/**
 * Dispatch a single EIP-6963 announcement event.
 */
function dispatchAnnouncement(detail: { info: typeof PROVIDER_INFO; provider: EthereumProvider }): void {
  const event = new CustomEvent("eip6963:announceProvider", {
    detail,
  });
  window.dispatchEvent(event);
}
