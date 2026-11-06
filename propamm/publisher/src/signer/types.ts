import type { Address, Hex } from "viem";

export interface RawSignature {
  r: Hex;
  s: Hex; // low-s normalised
  yParity: 0 | 1;
}

/** Signs a 32-byte digest. Callers (tx.ts) are responsible for the target/selector allowlist. */
export interface Signer {
  readonly kind: string;
  readonly address: Address;
  signDigest(digest: Hex): Promise<RawSignature>;
}
