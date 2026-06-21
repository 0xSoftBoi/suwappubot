import type { VersionedTransaction } from '@solana/web3.js'

// Minimal typing for Phantom's injected provider. We talk to Phantom directly
// (no wallet-adapter stack) since Phantom is the target Solana wallet — keeps the
// bundle lean and avoids extra React providers around the app.
export interface PhantomProvider {
  isPhantom?: boolean
  publicKey: { toString(): string } | null
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>
  disconnect(): Promise<void>
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>
  signAndSendTransaction(tx: VersionedTransaction): Promise<{ signature: string }>
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
