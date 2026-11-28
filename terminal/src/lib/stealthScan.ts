import { secp256k1 } from '@noble/curves/secp256k1'
import { hexToBytes, keccak256, bytesToHex } from 'viem'
import type { Announcement } from './bankApi'

/**
 * Local ERC-5564 scheme-1 (secp256k1 + view tags) scanning. Mirrors api-ts services/bank/stealth.ts scanAnnouncements:
 * shared = ephemeralPub * viewPriv; hash = keccak256(x coordinate); view tag = first byte of hash;
 * stealth address = address(spendPub + hash*G). The view key never leaves this function's arguments.
 */
const N = secp256k1.CURVE.n
const G = secp256k1.ProjectivePoint.BASE
type Pt = InstanceType<typeof secp256k1.ProjectivePoint>

const sharedHash = (p: Pt) => keccak256(bytesToHex(p.toRawBytes(false).slice(1, 33)))
const addrOf = (p: Pt) => `0x${keccak256(bytesToHex(p.toRawBytes(false).slice(1))).slice(-40)}`

export interface LocalMatch { stealthAddress: string; txHash?: string | null; blockNumber?: string | number | null }

/** Returns the announcements addressed to this view/spend key pair. Throws only on malformed keys. */
export function scanLocally(anns: Announcement[], viewPrivateKey: string, spendPublicKey: string): LocalMatch[] {
  const v = BigInt(viewPrivateKey)
  if (v <= 0n || v >= N) throw new Error('That view key is not a valid secp256k1 private key.')
  const spend = secp256k1.ProjectivePoint.fromHex(spendPublicKey.slice(2))
  const out: LocalMatch[] = []
  for (const a of anns) {
    let sh: string
    try { sh = sharedHash(secp256k1.ProjectivePoint.fromHex(hexToBytes(a.ephemeralPublicKey as `0x${string}`)).multiply(v)) } catch { continue }
    const tag = (a.viewTag || a.metadata?.slice(0, 4) || '').slice(2, 4).toLowerCase()
    if (tag && tag !== sh.slice(2, 4)) continue // view-tag fast reject
    const s = BigInt(sh) % N
    if (s === 0n) continue
    if (addrOf(spend.add(G.multiply(s))).toLowerCase() !== a.stealthAddress.toLowerCase()) continue
    out.push({ stealthAddress: a.stealthAddress, txHash: a.txHash, blockNumber: a.blockNumber })
  }
  return out
}
