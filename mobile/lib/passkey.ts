/**
 * Passkey (WebAuthn) wrappers for React Native.
 *
 * Wraps `react-native-passkeys` to provide the same interface expected
 * by AuthContext: createPasskey() for registration, getPasskeyCredential()
 * for authentication.
 *
 * On iOS this uses the ASAuthorization framework (Face ID / Touch ID).
 */
import { create, get } from 'react-native-passkeys'

// ── Registration ──────────────────────────────────────────────

export interface PasskeyCreationOptions {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: Array<{ alg: number; type: 'public-key' }>
  authenticatorSelection?: {
    authenticatorAttachment?: 'platform' | 'cross-platform'
    residentKey?: 'required' | 'preferred' | 'discouraged'
    userVerification?: 'required' | 'preferred' | 'discouraged'
  }
  attestation?: 'none' | 'indirect' | 'direct'
}

/**
 * Create a new passkey credential (registration).
 * Triggers Face ID / Touch ID prompt.
 */
export async function createPasskey(options: PasskeyCreationOptions): Promise<unknown> {
  const result = await create({
    challenge: options.challenge,
    rp: options.rp,
    user: options.user,
    pubKeyCredParams: options.pubKeyCredParams,
    authenticatorSelection: options.authenticatorSelection,
    attestation: options.attestation ?? 'none',
  })

  return result
}

// ── Authentication ────────────────────────────────────────────

export interface PasskeyAuthOptions {
  challenge: string
  rpId: string
  allowCredentials?: Array<{ id: string; type: 'public-key' }>
  userVerification?: 'required' | 'preferred' | 'discouraged'
}

/**
 * Authenticate with an existing passkey (assertion).
 * Triggers Face ID / Touch ID prompt.
 */
export async function getPasskeyCredential(options: PasskeyAuthOptions): Promise<unknown> {
  const result = await get({
    challenge: options.challenge,
    rpId: options.rpId,
    allowCredentials: options.allowCredentials,
    userVerification: options.userVerification ?? 'required',
  })

  return result
}
