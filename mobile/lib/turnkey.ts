/**
 * Turnkey SDK integration for native biometric signing.
 *
 * Uses @turnkey/react-native-passkey-stamper for native passkey
 * operations and @turnkey/http for API communication.
 */
import { TurnkeyClient } from '@turnkey/http'
import { PasskeyStamper } from '@turnkey/react-native-passkey-stamper'

const TURNKEY_BASE_URL = 'https://api.turnkey.com'
const TURNKEY_RP_ID = process.env.EXPO_PUBLIC_TURNKEY_RP_ID || 'suwappu.bot'
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.suwappu.bot'

let stamper: PasskeyStamper | null = null
let turnkeyClient: TurnkeyClient | null = null

/**
 * Get or create the passkey stamper for Turnkey API authentication.
 */
function getStamper(): PasskeyStamper {
  if (!stamper) {
    stamper = new PasskeyStamper({
      rpId: TURNKEY_RP_ID,
    })
  }
  return stamper
}

/**
 * Get or create the Turnkey HTTP client with passkey stamper.
 */
export function getTurnkeyClient(): TurnkeyClient {
  if (!turnkeyClient) {
    turnkeyClient = new TurnkeyClient(
      { baseUrl: TURNKEY_BASE_URL },
      getStamper()
    )
  }
  return turnkeyClient
}

/**
 * Create a new Turnkey wallet via the backend API.
 * The backend handles sub-org creation; we just need the response.
 */
export async function createTurnkeyWallet(authToken: string): Promise<{
  address: string
  subOrgId: string
  walletId: string
}> {
  const response = await fetch(`${API_BASE_URL}/webapp/turnkey/create-wallet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to create Turnkey wallet')
  }

  return response.json()
}

/**
 * Sign an EVM transaction using Turnkey's native passkey signing.
 * This prompts the user for biometric auth on device.
 */
export async function signTransaction(
  subOrgId: string,
  unsignedTransaction: string,
  signWith: string,
): Promise<string> {
  const client = getTurnkeyClient()

  const result = await client.signTransaction({
    type: 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2',
    organizationId: subOrgId,
    parameters: {
      type: 'TRANSACTION_TYPE_ETHEREUM',
      unsignedTransaction,
      signWith,
    },
    timestampMs: String(Date.now()),
  })

  return result.activity.result.signTransactionResult?.signedTransaction || ''
}

/**
 * Sign a raw payload (message hash) using Turnkey's native passkey signing.
 */
export async function signRawPayload(
  subOrgId: string,
  payload: string,
  signWith: string,
  hashFunction: string = 'HASH_FUNCTION_KECCAK256',
): Promise<{ r: string; s: string; v: string }> {
  const client = getTurnkeyClient()

  const result = await client.signRawPayload({
    type: 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2',
    organizationId: subOrgId,
    parameters: {
      payload,
      signWith,
      encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
      hashFunction,
    },
    timestampMs: String(Date.now()),
  })

  const signResult = result.activity.result.signRawPayloadResult
  return {
    r: signResult?.r || '',
    s: signResult?.s || '',
    v: signResult?.v || '',
  }
}

/**
 * Reset the Turnkey client (e.g., on logout).
 */
export function resetTurnkeyClient(): void {
  turnkeyClient = null
  stamper = null
}
