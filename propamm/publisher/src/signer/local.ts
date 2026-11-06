import { toHex, type Address, type Hex } from "viem";
import { privateKeyToAddress, sign } from "viem/accounts";
import { TESTNET_CHAIN_IDS } from "../config";
import type { RawSignature, Signer } from "./types";

/** Env-key signer. REFUSES to construct unless the chain is a testnet/local, or an explicit mainnet override is set. */
export class LocalDevSigner implements Signer {
  readonly kind = "local-dev";
  readonly address: Address;
  #key: Hex;

  constructor(privateKey: Hex, chainId: number, allowMainnetOverride: string | undefined) {
    const isTestnet = (TESTNET_CHAIN_IDS as readonly number[]).includes(chainId);
    if (!isTestnet && allowMainnetOverride !== "I_UNDERSTAND") {
      throw new Error(`LocalDevSigner refused: chainId ${chainId} is not in testnet allowlist and ALLOW_LOCAL_KEY_ON_MAINNET is not set`);
    }
    this.#key = privateKey;
    this.address = privateKeyToAddress(privateKey);
  }

  async signDigest(digest: Hex): Promise<RawSignature> {
    const sig = await sign({ hash: digest, privateKey: this.#key, to: "object" });
    const yParity = sig.yParity ?? (sig.v === 28n ? 1 : 0);
    return { r: sig.r, s: sig.s, yParity: yParity as 0 | 1 };
  }

  toJSON() {
    return { kind: this.kind, address: this.address };
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `LocalDevSigner(${this.address})`;
  }
}

export { toHex };
