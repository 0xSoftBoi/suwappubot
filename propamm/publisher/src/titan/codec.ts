import protobuf from "protobufjs";
import { hexToBytes, bytesToHex, type Address, type Hex } from "viem";
import { readFileSync } from "node:fs";

// Reflection-based (no codegen). Schema file is read at startup from disk.
const root = protobuf.parse(readFileSync(new URL("./quote_update.proto", import.meta.url), "utf8")).root;
const Args = root.lookupType("PWebsocketQuoteUpdateV1Args");
const Resp = root.lookupType("PWebsocketQuoteUpdateV1Response");

export interface QuoteArgs {
  tx: Uint8Array; // empty = cancel
  blockNumber: bigint;
  uuid: Uint8Array; // 16 bytes
  seq: number;
  assetPairs: Uint8Array[]; // each 40 bytes
  quoteAddress: Address;
  poolAddresses: Address[];
}

export function assetPair(token0: Address, token1: Address): Uint8Array {
  return hexToBytes(("0x" + token0.slice(2) + token1.slice(2)) as Hex);
}

export function encodeArgs(a: QuoteArgs): Uint8Array {
  if (a.uuid.length !== 16) throw new Error("uuid must be 16 bytes");
  if (a.seq <= 0 || !Number.isSafeInteger(a.seq)) throw new Error("seq must be > 0");
  for (const p of a.assetPairs) if (p.length !== 40) throw new Error("asset pair must be 40 bytes");
  const msg = Args.fromObject({
    tx: a.tx,
    blockNumber: a.blockNumber.toString(),
    replacementUuid: a.uuid,
    replacementSeqNumber: a.seq,
    disableCrossRegionSharing: true,
    assetPairs: a.assetPairs,
    quoteAddress: hexToBytes(a.quoteAddress),
    poolAddresses: a.poolAddresses.map((p) => hexToBytes(p)),
  });
  const err = Args.verify(msg);
  if (err) throw new Error(`proto verify: ${err}`);
  return Args.encode(msg).finish();
}

export interface DecodedArgs {
  tx: Uint8Array;
  blockNumber: bigint;
  uuid: Uint8Array;
  seq: number;
  disableCrossRegionSharing: boolean;
  assetPairs: Uint8Array[];
  quoteAddress: Uint8Array;
  poolAddresses: Uint8Array[];
}

export function decodeArgs(buf: Uint8Array): DecodedArgs {
  const o = Args.toObject(Args.decode(buf), { longs: String, bytes: Array, defaults: true }) as Record<string, any>;
  return {
    tx: Uint8Array.from(o.tx ?? []),
    blockNumber: BigInt(o.blockNumber ?? "0"),
    uuid: Uint8Array.from(o.replacementUuid ?? []),
    seq: Number(o.replacementSeqNumber ?? "0"),
    disableCrossRegionSharing: Boolean(o.disableCrossRegionSharing),
    assetPairs: (o.assetPairs ?? []).map((x: number[]) => Uint8Array.from(x)),
    quoteAddress: Uint8Array.from(o.quoteAddress ?? []),
    poolAddresses: (o.poolAddresses ?? []).map((x: number[]) => Uint8Array.from(x)),
  };
}

export interface QuoteResponse {
  uuid: Uint8Array;
  seq: number;
  timestampNs: bigint;
  error: string;
  bundleHash: Uint8Array;
}

export function encodeResponse(r: QuoteResponse): Uint8Array {
  const msg = Resp.fromObject({
    replacementUuid: r.uuid,
    replacementSeqNumber: r.seq,
    timestamp: r.timestampNs.toString(),
    error: r.error,
    bundleHash: r.bundleHash,
  });
  return Resp.encode(msg).finish();
}

export function decodeResponse(buf: Uint8Array): QuoteResponse {
  const o = Resp.toObject(Resp.decode(buf), { longs: String, bytes: Array, defaults: true }) as Record<string, any>;
  return {
    uuid: Uint8Array.from(o.replacementUuid ?? []),
    seq: Number(o.replacementSeqNumber ?? "0"),
    timestampNs: BigInt(o.timestamp ?? "0"),
    error: String(o.error ?? ""),
    bundleHash: Uint8Array.from(o.bundleHash ?? []),
  };
}

export const hex = (b: Uint8Array) => bytesToHex(b);
