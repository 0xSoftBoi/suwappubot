/**
 * Turnkey Embedded Wallet SDK wrapper.
 *
 * Provides passkey-based wallet creation and signing using Turnkey's
 * browser SDK with WebAuthn for secure key management.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const TURNKEY_ORG_ID = process.env.NEXT_PUBLIC_TURNKEY_ORG_ID || '';

// Passkey registration result
export interface PasskeyRegistration {
  success: boolean;
  userId: number;
  walletAddress: string;
  subOrgId: string;
  error?: string;
}

// Passkey authentication result
export interface PasskeyAuthResult {
  success: boolean;
  token: string;
  userId: number;
  walletAddress: string;
  expiresAt: string;
  error?: string;
}

// Registration init response from backend
interface RegistrationInitResponse {
  challenge: string;
  userId: string;
  userName: string;
  rpId: string;
  rpName: string;
  attestation: 'none' | 'indirect' | 'direct';
}

// Authentication init response from backend
interface AuthenticationInitResponse {
  challenge: string;
  rpId: string;
  allowCredentials?: {
    id: string;
    type: 'public-key';
  }[];
}

/**
 * Check if WebAuthn is supported in this browser.
 */
export function isPasskeySupported(): boolean {
  if (typeof window === 'undefined') return false;

  return (
    window.PublicKeyCredential !== undefined &&
    typeof window.PublicKeyCredential === 'function'
  );
}

/**
 * Check if platform authenticator (Face ID, Touch ID, Windows Hello) is available.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isPasskeySupported()) return false;

  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available;
  } catch {
    return false;
  }
}

/**
 * Base64URL encode a buffer.
 */
function bufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64URL decode to buffer.
 */
function base64URLToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Initialize passkey registration.
 *
 * Starts the registration flow by getting challenge from backend.
 */
export async function initPasskeyRegistration(
  email?: string,
  displayName?: string
): Promise<RegistrationInitResponse> {
  const response = await fetch(`${API_BASE}/auth/passkey/register/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      email,
      displayName: displayName || email || 'Suwappu User',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to initialize registration');
  }

  return response.json();
}

/**
 * Complete passkey registration.
 *
 * Creates a new passkey using WebAuthn and registers it with Turnkey.
 */
export async function registerPasskey(
  email?: string,
  displayName?: string
): Promise<PasskeyRegistration> {
  if (!isPasskeySupported()) {
    return {
      success: false,
      userId: 0,
      walletAddress: '',
      subOrgId: '',
      error: 'Passkeys are not supported in this browser',
    };
  }

  try {
    // 1. Initialize registration with backend
    const initData = await initPasskeyRegistration(email, displayName);

    // 2. Create WebAuthn credential
    const credentialCreationOptions: CredentialCreationOptions = {
      publicKey: {
        challenge: base64URLToBuffer(initData.challenge),
        rp: {
          id: initData.rpId,
          name: initData.rpName,
        },
        user: {
          id: new TextEncoder().encode(initData.userId),
          name: initData.userName,
          displayName: displayName || initData.userName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'required',
          requireResidentKey: true,
        },
        timeout: 60000,
        attestation: initData.attestation,
      },
    };

    const credential = (await navigator.credentials.create(
      credentialCreationOptions
    )) as PublicKeyCredential;

    if (!credential) {
      throw new Error('Failed to create credential');
    }

    const attestationResponse = credential.response as AuthenticatorAttestationResponse;

    // 3. Send credential to backend to complete registration
    const completeResponse = await fetch(
      `${API_BASE}/auth/passkey/register/complete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          credentialId: bufferToBase64URL(credential.rawId),
          attestationObject: bufferToBase64URL(attestationResponse.attestationObject),
          clientDataJSON: bufferToBase64URL(attestationResponse.clientDataJSON),
          transports: attestationResponse.getTransports?.() || [],
        }),
      }
    );

    if (!completeResponse.ok) {
      const error = await completeResponse.json();
      throw new Error(error.detail || 'Failed to complete registration');
    }

    const result = await completeResponse.json();

    return {
      success: true,
      userId: result.userId,
      walletAddress: result.walletAddress,
      subOrgId: result.subOrgId,
    };
  } catch (error: any) {
    console.error('Passkey registration failed:', error);

    // Handle specific WebAuthn errors
    if (error.name === 'NotAllowedError') {
      return {
        success: false,
        userId: 0,
        walletAddress: '',
        subOrgId: '',
        error: 'Passkey creation was cancelled or timed out',
      };
    }

    if (error.name === 'InvalidStateError') {
      return {
        success: false,
        userId: 0,
        walletAddress: '',
        subOrgId: '',
        error: 'A passkey already exists for this device',
      };
    }

    return {
      success: false,
      userId: 0,
      walletAddress: '',
      subOrgId: '',
      error: error.message || 'Failed to create passkey',
    };
  }
}

/**
 * Authenticate using an existing passkey.
 */
export async function authenticateWithPasskey(): Promise<PasskeyAuthResult> {
  if (!isPasskeySupported()) {
    return {
      success: false,
      token: '',
      userId: 0,
      walletAddress: '',
      expiresAt: '',
      error: 'Passkeys are not supported in this browser',
    };
  }

  try {
    // 1. Initialize authentication with backend
    const initResponse = await fetch(`${API_BASE}/auth/passkey/authenticate/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!initResponse.ok) {
      const error = await initResponse.json();
      throw new Error(error.detail || 'Failed to initialize authentication');
    }

    const initData: AuthenticationInitResponse = await initResponse.json();

    // 2. Get credential from WebAuthn
    const credentialRequestOptions: CredentialRequestOptions = {
      publicKey: {
        challenge: base64URLToBuffer(initData.challenge),
        rpId: initData.rpId,
        allowCredentials: initData.allowCredentials?.map((cred) => ({
          id: base64URLToBuffer(cred.id),
          type: cred.type,
          transports: ['internal', 'hybrid'] as AuthenticatorTransport[],
        })),
        userVerification: 'required',
        timeout: 60000,
      },
    };

    const credential = (await navigator.credentials.get(
      credentialRequestOptions
    )) as PublicKeyCredential;

    if (!credential) {
      throw new Error('Failed to get credential');
    }

    const assertionResponse = credential.response as AuthenticatorAssertionResponse;

    // 3. Send assertion to backend to complete authentication
    const verifyResponse = await fetch(`${API_BASE}/auth/passkey/authenticate/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        credentialId: bufferToBase64URL(credential.rawId),
        authenticatorData: bufferToBase64URL(assertionResponse.authenticatorData),
        clientDataJSON: bufferToBase64URL(assertionResponse.clientDataJSON),
        signature: bufferToBase64URL(assertionResponse.signature),
        userHandle: assertionResponse.userHandle
          ? bufferToBase64URL(assertionResponse.userHandle)
          : null,
      }),
    });

    if (!verifyResponse.ok) {
      const error = await verifyResponse.json();
      throw new Error(error.detail || 'Authentication failed');
    }

    const result = await verifyResponse.json();

    return {
      success: true,
      token: result.token,
      userId: result.userId,
      walletAddress: result.walletAddress,
      expiresAt: result.expiresAt,
    };
  } catch (error: any) {
    console.error('Passkey authentication failed:', error);

    if (error.name === 'NotAllowedError') {
      return {
        success: false,
        token: '',
        userId: 0,
        walletAddress: '',
        expiresAt: '',
        error: 'Authentication was cancelled or timed out',
      };
    }

    return {
      success: false,
      token: '',
      userId: 0,
      walletAddress: '',
      expiresAt: '',
      error: error.message || 'Authentication failed',
    };
  }
}

/**
 * Sign a transaction using Turnkey passkey.
 *
 * Uses the Turnkey iframe stamper for secure signing.
 */
export async function signTransactionWithPasskey(
  unsignedTx: string,
  walletAddress: string
): Promise<{ success: boolean; signedTx?: string; error?: string }> {
  try {
    // Request signature from backend (which will trigger Turnkey signing)
    const response = await fetch(`${API_BASE}/auth/passkey/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        unsignedTransaction: unsignedTx,
        walletAddress,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Signing failed');
    }

    const result = await response.json();

    return {
      success: true,
      signedTx: result.signedTransaction,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to sign transaction',
    };
  }
}

/**
 * Get user's Turnkey wallets.
 */
export async function getTurnkeyWallets(): Promise<
  Array<{
    id: string;
    address: string;
    chainType: string;
    name: string;
  }>
> {
  try {
    const response = await fetch(`${API_BASE}/auth/passkey/wallets`, {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      return [];
    }

    return response.json();
  } catch {
    return [];
  }
}

/**
 * Create a new wallet in the user's Turnkey sub-organization.
 */
export async function createTurnkeyWallet(
  chainType: 'evm' | 'solana',
  name?: string
): Promise<{
  success: boolean;
  address?: string;
  walletId?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${API_BASE}/auth/passkey/wallets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        chainType,
        name: name || `${chainType.toUpperCase()} Wallet`,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create wallet');
    }

    const result = await response.json();

    return {
      success: true,
      address: result.address,
      walletId: result.walletId,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to create wallet',
    };
  }
}
