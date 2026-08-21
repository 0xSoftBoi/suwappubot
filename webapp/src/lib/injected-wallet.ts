import { stringToHex } from 'viem'

interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>
}

interface PhantomProvider {
  isPhantom?: boolean
  publicKey: { toString(): string } | null
  connect(): Promise<{ publicKey: { toString(): string } }>
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider }
    solana?: PhantomProvider
  }
}

function requireEvmProvider(): Eip1193Provider {
  const provider = (window as Window & { ethereum?: Eip1193Provider }).ethereum
  if (!provider) {
    throw new Error('No EVM wallet found. Open Suwappu in MetaMask or another wallet browser.')
  }
  return provider
}

function requirePhantom(): PhantomProvider {
  const provider = window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : undefined)
  if (!provider) {
    throw new Error('Phantom was not found. Open Suwappu in the Phantom browser and try again.')
  }
  return provider
}

/** Connect the injected EVM wallet without ever exposing a private key to Suwappu. */
export async function connectEvmWallet(): Promise<string> {
  const accounts = await requireEvmProvider().request({ method: 'eth_requestAccounts' })
  const address = Array.isArray(accounts) ? accounts[0] : undefined
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('The wallet did not return a valid Ethereum address.')
  }
  return address
}

/** Sign the server-issued SIWE message with an injected EIP-1193 wallet. */
export async function signEvmMessage(address: string, message: string): Promise<string> {
  const signature = await requireEvmProvider().request({
    method: 'personal_sign',
    params: [stringToHex(message), address],
  })
  if (typeof signature !== 'string' || !signature.startsWith('0x')) {
    throw new Error('The wallet did not return a valid signature.')
  }
  return signature
}

/** Connect Phantom's injected Solana provider. */
export async function connectPhantomWallet(): Promise<string> {
  const { publicKey } = await requirePhantom().connect()
  const address = publicKey?.toString()
  if (!address) throw new Error('Phantom did not return a wallet address.')
  return address
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Encode Phantom's raw ed25519 signature in the base58 format expected by the API. */
export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''

  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] * 256
      digits[i] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }

  let encoded = ''
  for (let i = 0; i < bytes.length - 1 && bytes[i] === 0; i += 1) encoded += '1'
  for (let i = digits.length - 1; i >= 0; i -= 1) encoded += BASE58_ALPHABET[digits[i]]
  return encoded
}

/** Sign the server-issued SIWS message with Phantom. */
export async function signPhantomMessage(message: string): Promise<string> {
  const { signature } = await requirePhantom().signMessage(new TextEncoder().encode(message), 'utf8')
  return encodeBase58(signature)
}
