import {
  type InpageToContent,
  type ContentToInpage,
  type PortMessage,
} from "@/shared/protocol";
import { WALLET_NAMESPACE, PORT_NAME } from "@/shared/constants";

/**
 * Content script bridge running in the ISOLATED world at document_start.
 *
 * Responsibilities:
 * 1. Inject src/inpage/index.ts into the MAIN world via a web-accessible <script>.
 * 2. Open a long-lived chrome.runtime.Port to the background (reconnect on disconnect).
 * 3. Relay InpageToContent messages from the page to the background via the port.
 * 4. Relay PortMessage responses back to the page as ContentToInpage.
 * 5. Defensively validate all message shapes.
 */

/**
 * Injects the inpage provider script into the MAIN world.
 * The script is loaded as a web-accessible resource and runs before any
 * page content, ensuring providers are available to dApp code.
 */
function injectInpageProvider(): void {
  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/inpage/index.ts");
    script.type = "module";
    script.onload = () => {
      script.remove();
    };
    script.onerror = () => {
      script.remove();
    };
    document.documentElement.insertBefore(script, document.documentElement.firstChild);
  } catch (err) {
    console.error("[suwappu-wallet] Failed to inject inpage provider:", err);
  }
}

/**
 * Validates the shape of an InpageToContent message.
 */
function isValidInpageToContent(msg: unknown): msg is InpageToContent {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.namespace === WALLET_NAMESPACE &&
    m.target === "content" &&
    (m.chain === "eip155" || m.chain === "solana") &&
    typeof m.payload === "object" &&
    m.payload !== null &&
    typeof (m.payload as Record<string, unknown>).id === "string" &&
    typeof (m.payload as Record<string, unknown>).method === "string"
  );
}

/**
 * Manages the long-lived port connection to the background and message relay.
 */
function setupPortConnection(): void {
  let port: chrome.runtime.Port | null = null;

  /**
   * Establish or reconnect the port to the background.
   */
  function connectPort(): void {
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });

      port.onMessage.addListener((message: unknown) => {
        const msg = message as Record<string, unknown>;

        // Route PortMessage responses back to the page.
        if (msg.kind === "rpc-result") {
          const portMsg = msg as PortMessage & { kind: "rpc-result" };
          const response: ContentToInpage = {
            namespace: WALLET_NAMESPACE,
            target: "inpage",
            chain: portMsg.chain,
            payload: portMsg.response,
          };
          window.postMessage(response, location.origin);
        } else if (msg.kind === "event") {
          const portMsg = msg as PortMessage & { kind: "event" };
          const response: ContentToInpage = {
            namespace: WALLET_NAMESPACE,
            target: "inpage",
            chain: portMsg.chain,
            event: portMsg.event,
          };
          window.postMessage(response, location.origin);
        }
      });

      port.onDisconnect.addListener(() => {
        port = null;
        // Attempt to reconnect after a short delay.
        setTimeout(() => {
          connectPort();
        }, 100);
      });
    } catch (err) {
      console.error("[suwappu-wallet] Failed to connect port:", err);
      // Retry connection after a delay.
      setTimeout(() => {
        connectPort();
      }, 100);
    }
  }

  // Establish initial connection.
  connectPort();

  /**
   * Listen for messages from the inpage provider (via window.postMessage).
   * Validate and forward RPC requests to the background via the port.
   */
  window.addEventListener("message", (event) => {
    // Only accept messages from the same origin to prevent abuse.
    if (event.origin !== location.origin) return;

    const msg = event.data;

    // Validate the message shape.
    if (!isValidInpageToContent(msg)) return;

    // Forward to the background only if the port is connected.
    if (port) {
      try {
        const portMessage: PortMessage = {
          kind: "rpc",
          chain: msg.chain,
          origin: location.origin,
          request: msg.payload,
        };
        port.postMessage(portMessage);
      } catch (err) {
        console.error("[suwappu-wallet] Failed to forward message to background:", err);
      }
    }
  });
}

// Initialize the bridge: inject provider and set up port connection.
injectInpageProvider();
setupPortConnection();
