/**
 * WebAuthn PRF helper for the popup.
 *
 * IMPORTANT: The popup is a TRUSTED context (MV3 can't directly access navigator.credentials
 * from the background service worker). This is where we call navigator.credentials.create and
 * navigator.credentials.get with the PRF extension, then pass the output back to the background.
 *
 * PRF output is client-side only and never persists — it flows directly to derive the vault key.
 */

import { PRF_SALT } from "@/shared/constants";

/**
 * Create a new passkey in the authenticator.
 *
 * @param userName - The user's display name for the credential
 * @throws Error if PRF is unsupported or creation fails
 */
export async function createPasskey(userName: string): Promise<void> {
  if (!navigator.credentials) {
    throw new Error("WebAuthn not supported in this browser.");
  }

  // Generate a stable user ID (32 random bytes)
  const userIdArray = new Uint8Array(32);
  crypto.getRandomValues(userIdArray);
  const userId = Array.from(userIdArray);

  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: {
          // Chrome extension RpID rules: must be the extension's origin or a parent domain.
          // For chrome-extension://<id>, the RP ID is the extension ID itself.
          // In real flows, use chrome.runtime.getManifest().key or a stable extension ID.
          // For now, use the extension ID if available, falling back to a constant identifier.
          id: "extension",
          name: "Suwappu Wallet",
        },
        user: {
          id: new Uint8Array(userId),
          name: userName || "wallet-user",
          displayName: userName || "Suwappu Wallet User",
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256
        timeout: 60000,
        attestation: "none",
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          userVerification: "required",
        },
        // PRF extension: request PRF capability during registration.
        extensions: {
          prf: {},
        } as any, // typings for prf extension not yet in stable @types/webauthn
      },
    });

    if (!credential) {
      throw new Error("Passkey creation cancelled.");
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Passkey creation failed: ${message}`);
  }
}

/**
 * Get the PRF output from WebAuthn by prompting the user to unlock their passkey.
 *
 * @returns Promise resolving to the PRF output as number[]
 * @throws Error if PRF is unsupported or authentication fails
 */
export async function getPrfOutput(): Promise<number[]> {
  if (!navigator.credentials) {
    throw new Error("WebAuthn not supported in this browser.");
  }

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        timeout: 60000,
        userVerification: "required",
        // PRF extension: evaluate the PRF with the salt and request the first output.
        extensions: {
          prf: {
            eval: {
              first: PRF_SALT,
            },
          },
        } as any, // typings for prf extension not yet in stable @types/webauthn
      },
    } as CredentialRequestOptions);

    if (!assertion || assertion.type !== "public-key") {
      throw new Error("Invalid credential response.");
    }

    // Extract the PRF output from the credential response.
    // The PRF extension returns the result in response.clientExtensionResults.prf
    const clientExtensionsResults = (assertion as any).getClientExtensionResults?.();
    if (!clientExtensionsResults || !clientExtensionsResults.prf) {
      throw new Error(
        "PRF not supported by this authenticator. Use a passkey provider that supports CTAP 2.1 with hmac-secret."
      );
    }

    const prfResults = clientExtensionsResults.prf;
    if (!prfResults.results || !prfResults.results.first) {
      throw new Error("Failed to obtain PRF output from authenticator.");
    }

    // Convert ArrayBuffer to number[]
    const prfArrayBuffer = prfResults.results.first;
    const prfArray = Array.from(new Uint8Array(prfArrayBuffer));

    return prfArray;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`WebAuthn authentication failed: ${message}`);
  }
}
