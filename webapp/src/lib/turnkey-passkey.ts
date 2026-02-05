/**
 * Turnkey Embedded Wallet SDK wrapper for passkey authentication.
 *
 * Provides passkey-based wallet creation and signing using WebAuthn
 * for secure key management within Telegram Mini App.
 */

import type {
  PasskeyRegistration,
  PasskeyAuthResult,
  RegistrationInitResponse,
  AuthenticationInitResponse,
} from '@suwappu/shared'
import { getInitData } from './telegram'

const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * Check if WebAuthn is supported in this browser.
 */
export function isPasskeySupported(): boolean {
  if (typeof window === 'undefined') return false

  return (
    window.PublicKeyCredential !== undefined &&
    typeof window.PublicKeyCredential === 'function'
  )
}

/**
 * Check if platform authenticator (Face ID, Touch ID, Windows Hello) is available.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isPasskeySupported()) return false

  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    return available
  } catch {
    return false
  }
}

/**
 * Base64URL encode a buffer.
 */
function bufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ''
  for (const byte of bytes) {
    str += String.fromCharCode(byte)
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Base64URL decode to buffer.
 */
function base64URLToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(base64 + padding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Get auth headers including Telegram initData
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const initData = getInitData()
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData
  }

  return headers
}

/**
 * Initialize passkey registration.
 */
export async function initPasskeyRegistration(
  displayName?: string
): Promise<RegistrationInitResponse> {
  const response = await fetch(`${API_BASE}/webapp/passkey/register/init`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      displayName: displayName || 'Suwappu User',
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to initialize registration' }))
    throw new Error(error.detail || 'Failed to initialize registration')
  }

  return response.json()
}

/**
 * Complete passkey registration.
 *
 * Creates a new passkey using WebAuthn and registers it with Turnkey.
 */
export async function registerPasskey(
  displayName?: string
): Promise<PasskeyRegistration> {
  if (!isPasskeySupported()) {
    return {
      success: false,
      userId: 0,
      walletAddress: '',
      subOrgId: '',
      error: 'Passkeys are not supported in this browser',
    }
  }

  try {
    // 1. Initialize registration with backend
    const initData = await initPasskeyRegistration(displayName)

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
    }

    const credential = (await navigator.credentials.create(
      credentialCreationOptions
    )) as PublicKeyCredential

    if (!credential) {
      throw new Error('Failed to create credential')
    }

    const attestationResponse = credential.response as AuthenticatorAttestationResponse

    // 3. Send credential to backend to complete registration
    const completeResponse = await fetch(
      `${API_BASE}/webapp/passkey/register/complete`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          credentialId: bufferToBase64URL(credential.rawId),
          attestationObject: bufferToBase64URL(attestationResponse.attestationObject),
          clientDataJSON: bufferToBase64URL(attestationResponse.clientDataJSON),
          transports: attestationResponse.getTransports?.() || [],
        }),
      }
    )

    if (!completeResponse.ok) {
      const error = await completeResponse.json().catch(() => ({ detail: 'Failed to complete registration' }))
      throw new Error(error.detail || 'Failed to complete registration')
    }

    const result = await completeResponse.json()

    return {
      success: true,
      userId: result.userId,
      walletAddress: result.walletAddress,
      subOrgId: result.subOrgId,
    }
  } catch (error: any) {
    console.error('Passkey registration failed:', error)

    // Handle specific WebAuthn errors
    if (error.name === 'NotAllowedError') {
      return {
        success: false,
        userId: 0,
        walletAddress: '',
        subOrgId: '',
        error: 'Passkey creation was cancelled or timed out',
      }
    }

    if (error.name === 'InvalidStateError') {
      return {
        success: false,
        userId: 0,
        walletAddress: '',
        subOrgId: '',
        error: 'A passkey already exists for this device',
      }
    }

    return {
      success: false,
      userId: 0,
      walletAddress: '',
      subOrgId: '',
      error: error.message || 'Failed to create passkey',
    }
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
    }
  }

  try {
    // 1. Initialize authentication with backend
    const initResponse = await fetch(`${API_BASE}/webapp/passkey/authenticate/init`, {
      method: 'POST',
      headers: getAuthHeaders(),
    })

    if (!initResponse.ok) {
      const error = await initResponse.json().catch(() => ({ detail: 'Failed to initialize authentication' }))
      throw new Error(error.detail || 'Failed to initialize authentication')
    }

    const initData: AuthenticationInitResponse = await initResponse.json()

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
    }

    const credential = (await navigator.credentials.get(
      credentialRequestOptions
    )) as PublicKeyCredential

    if (!credential) {
      throw new Error('Failed to get credential')
    }

    const assertionResponse = credential.response as AuthenticatorAssertionResponse

    // 3. Send assertion to backend to complete authentication
    const verifyResponse = await fetch(`${API_BASE}/webapp/passkey/authenticate/complete`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        credentialId: bufferToBase64URL(credential.rawId),
        authenticatorData: bufferToBase64URL(assertionResponse.authenticatorData),
        clientDataJSON: bufferToBase64URL(assertionResponse.clientDataJSON),
        signature: bufferToBase64URL(assertionResponse.signature),
        userHandle: assertionResponse.userHandle
          ? bufferToBase64URL(assertionResponse.userHandle)
          : null,
      }),
    })

    if (!verifyResponse.ok) {
      const error = await verifyResponse.json().catch(() => ({ detail: 'Authentication failed' }))
      throw new Error(error.detail || 'Authentication failed')
    }

    const result = await verifyResponse.json()

    return {
      success: true,
      token: result.token,
      userId: result.userId,
      walletAddress: result.walletAddress,
      expiresAt: result.expiresAt,
    }
  } catch (error: any) {
    console.error('Passkey authentication failed:', error)

    if (error.name === 'NotAllowedError') {
      return {
        success: false,
        token: '',
        userId: 0,
        walletAddress: '',
        expiresAt: '',
        error: 'Authentication was cancelled or timed out',
      }
    }

    return {
      success: false,
      token: '',
      userId: 0,
      walletAddress: '',
      expiresAt: '',
      error: error.message || 'Authentication failed',
    }
  }
}

/**
 * Get user's Turnkey wallets.
 */
export async function getTurnkeyWallets(): Promise<
  Array<{
    id: string
    address: string
    chainType: string
    name: string
  }>
> {
  try {
    const response = await fetch(`${API_BASE}/webapp/passkey/wallets`, {
      method: 'GET',
      headers: getAuthHeaders(),
    })

    if (!response.ok) {
      return []
    }

    return response.json()
  } catch {
    return []
  }
}

/**
 * Create a new wallet in the user's Turnkey sub-organization.
 */
export async function createTurnkeyWallet(
  chainType: 'evm' | 'solana',
  name?: string
): Promise<{
  success: boolean
  address?: string
  walletId?: string
  error?: string
}> {
  try {
    const response = await fetch(`${API_BASE}/webapp/passkey/wallets`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        chainType,
        name: name || `${chainType.toUpperCase()} Wallet`,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to create wallet' }))
      throw new Error(error.detail || 'Failed to create wallet')
    }

    const result = await response.json()

    return {
      success: true,
      address: result.address,
      walletId: result.walletId,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to create wallet',
    }
  }
}

/**
 * Check if user has an active Turnkey session
 */
export function hasTurnkeySession(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const session = localStorage.getItem('turnkey_session')
    return session !== null
  } catch {
    return false
  }
}

/**
 * Logout from Turnkey (clear local session)
 */
export function logoutTurnkey(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem('turnkey_session')
    localStorage.removeItem('turnkey_sub_org_id')
  } catch (e) {
    console.error('Failed to clear Turnkey session:', e)
  }
}
