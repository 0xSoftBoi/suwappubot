import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { bytesToHex, hexToBigInt, keccak256, recoverAddress, toHex, type Address, type Hex } from "viem";
import type { RawSignature, Signer } from "./types";

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = N / 2n;

/** Minimal DER reader: SEQUENCE { INTEGER, INTEGER }. */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  let i = 0;
  const readLen = (): number => {
    const b = der[i++]!;
    if (b < 0x80) return b;
    const n = b & 0x7f;
    let len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | der[i++]!;
    return len;
  };
  if (der[i++] !== 0x30) throw new Error("DER: expected SEQUENCE");
  readLen();
  const readInt = (): bigint => {
    if (der[i++] !== 0x02) throw new Error("DER: expected INTEGER");
    const len = readLen();
    const bytes = der.slice(i, i + len);
    i += len;
    return hexToBigInt(bytesToHex(bytes));
  };
  const r = readInt();
  const s = readInt();
  return { r, s };
}

/** Extract uncompressed 65-byte secp256k1 pubkey from a SubjectPublicKeyInfo DER (it is the trailing BIT STRING). */
export function pubkeyFromSpki(spki: Uint8Array): Uint8Array {
  const pk = spki.slice(spki.length - 65);
  if (pk[0] !== 0x04) throw new Error("KMS public key is not an uncompressed secp256k1 point");
  return pk;
}

export function addressFromPubkey(pk: Uint8Array): Address {
  const h = keccak256(bytesToHex(pk.slice(1)));
  return ("0x" + h.slice(-40)) as Address;
}

/** AWS KMS ECC_SECG_P256K1 signer. Key never leaves KMS. */
export class KmsSigner implements Signer {
  readonly kind = "aws-kms";
  private constructor(private client: KMSClient, private keyId: string, readonly address: Address) {}

  static async create(keyId: string, region: string, expected?: Address): Promise<KmsSigner> {
    const client = new KMSClient({ region });
    const out = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
    if (!out.PublicKey) throw new Error("KMS GetPublicKey returned no key");
    if (out.KeySpec !== "ECC_SECG_P256K1") throw new Error(`KMS key spec ${out.KeySpec} != ECC_SECG_P256K1`);
    const address = addressFromPubkey(pubkeyFromSpki(out.PublicKey));
    if (expected && expected.toLowerCase() !== address.toLowerCase()) {
      throw new Error(`KMS key address ${address} != EXPECTED_PUSHER_ADDRESS`);
    }
    return new KmsSigner(client, keyId, address);
  }

  async signDigest(digest: Hex): Promise<RawSignature> {
    const out = await this.client.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: Buffer.from(digest.slice(2), "hex"),
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      }),
    );
    if (!out.Signature) throw new Error("KMS returned no signature");
    let { r, s } = parseDerSignature(out.Signature);
    if (s > HALF_N) s = N - s; // low-s (EIP-2)
    const rHex = toHex(r, { size: 32 });
    const sHex = toHex(s, { size: 32 });
    for (const yParity of [0, 1] as const) {
      try {
        const rec = await recoverAddress({ hash: digest, signature: { r: rHex, s: sHex, yParity } });
        if (rec.toLowerCase() === this.address.toLowerCase()) return { r: rHex, s: sHex, yParity };
      } catch {
        /* try next candidate */
      }
    }
    throw new Error("KMS signature: no recovery id matches signer address");
  }
}
