import type { VersionedTransaction } from '@solana/web3.js'

export interface PhantomSignInInput {
  domain?: string
  address?: string
  statement?: string
  uri?: string
  version?: string
  chainId?: string
  nonce?: string
  issuedAt?: string
  expirationTime?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
}

export interface PhantomSignInOutput {
  account?: { address?: string }
  signedMessage: Uint8Array
  signature: Uint8Array
  signatureType?: 'ed25519'
}

// Minimal typing for Phantom's injected provider. We talk to Phantom directly
// (no wallet-adapter stack) since Phantom is the target Solana wallet — keeps the
// bundle lean and avoids extra React providers around the app.
export interface PhantomProvider {
  isPhantom?: boolean
  publicKey: { toString(): string } | null
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>
  disconnect(): Promise<void>
  // Wallet-Standard SIWS capability. Newer Phantom providers can construct and
  // sign a domain-bound SIWS message in one prompt; older providers fall back
  // to connect() + signMessage().
  signIn?(input?: PhantomSignInInput): Promise<PhantomSignInOutput>
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>
  signAndSendTransaction(tx: VersionedTransaction): Promise<{ signature: string }>
  // Sign WITHOUT broadcasting — used for the Jito path, where we submit the
  // signed tx to the Jito block engine (via our server) instead of an RPC.
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider }
    solana?: PhantomProvider
  }
}

export function getPhantom(): PhantomProvider | null {
  if (typeof window === 'undefined') return null
  const injected = window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : undefined)
  return injected ?? null
}

export function isPhantomAvailable(): boolean {
  return getPhantom() != null
}

function challengeField(message: string, label: string): string | undefined {
  const prefix = `${label}: `
  return message
    .split('\n')
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
}

/**
 * Convert the backend's nonce-bound SIWS challenge into the Wallet-Standard
 * signIn input. We still compare Phantom's returned signedMessage byte-for-byte
 * with the server challenge before verification, so a wallet cannot silently
 * sign a different identity/domain payload.
 */
export function siwsInputFromChallenge(message: string, expectedAddress: string): PhantomSignInInput {
  const headerSuffix = ' wants you to sign in with your Solana account:'
  const lines = message.split('\n')
  const header = lines[0] ?? ''
  if (!header.endsWith(headerSuffix) || lines[1] !== expectedAddress) {
    throw new Error('Invalid Solana sign-in challenge.')
  }

  const advancedFieldIndex = lines.findIndex((line) => /^(URI|Version|Chain ID|Nonce|Issued At|Expiration Time|Not Before|Request ID): /.test(line))
  const statementLines = advancedFieldIndex > 2 ? lines.slice(2, advancedFieldIndex) : []
  const statement = statementLines.filter(Boolean).join(' ')
  const resourcesIndex = lines.findIndex((line) => line === 'Resources:')
  const resources = resourcesIndex >= 0
    ? lines.slice(resourcesIndex + 1).filter((line) => line.startsWith('- ')).map((line) => line.slice(2))
    : undefined

  return {
    domain: header.slice(0, -headerSuffix.length),
    address: expectedAddress,
    ...(statement ? { statement } : {}),
    ...(challengeField(message, 'URI') ? { uri: challengeField(message, 'URI') } : {}),
    ...(challengeField(message, 'Version') ? { version: challengeField(message, 'Version') } : {}),
    ...(challengeField(message, 'Chain ID') ? { chainId: challengeField(message, 'Chain ID') } : {}),
    ...(challengeField(message, 'Nonce') ? { nonce: challengeField(message, 'Nonce') } : {}),
    ...(challengeField(message, 'Issued At') ? { issuedAt: challengeField(message, 'Issued At') } : {}),
    ...(challengeField(message, 'Expiration Time') ? { expirationTime: challengeField(message, 'Expiration Time') } : {}),
    ...(challengeField(message, 'Not Before') ? { notBefore: challengeField(message, 'Not Before') } : {}),
    ...(challengeField(message, 'Request ID') ? { requestId: challengeField(message, 'Request ID') } : {}),
    ...(resources?.length ? { resources } : {}),
  }
}
