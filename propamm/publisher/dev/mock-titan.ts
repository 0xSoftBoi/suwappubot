// Local mock of Titan's /ws/sendquoteupdate. DEV ONLY. Acks every message; validates uuid/seq monotonicity.
// Usage: MOCK_PORT=9555 bun run dev/mock-titan.ts
import { keccak256, bytesToHex } from "viem";
import { decodeArgs, encodeResponse } from "../src/titan/codec";

const port = Number(process.env.MOCK_PORT ?? 9555);
const requireKey = process.env.MOCK_API_KEY;

interface Sess {
  uuid: string;
  lastSeq: number;
  n: number;
}

const out = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify({ t: new Date().toISOString(), mock: true, ...o }) + "\n");

Bun.serve<Sess>({
  hostname: "127.0.0.1",
  port,
  fetch(req, server) {
    if (requireKey && req.headers.get("authorization") !== requireKey) return new Response("unauthorized", { status: 401 });
    if (server.upgrade(req, { data: { uuid: "", lastSeq: 0, n: 0 } })) return;
    return new Response("upgrade required", { status: 426 });
  },
  websocket: {
    open() {
      out({ evt: "open" });
    },
    close() {
      out({ evt: "close" });
    },
    message(ws, msg) {
      const bytes = typeof msg === "string" ? new TextEncoder().encode(msg) : new Uint8Array(msg);
      let a;
      try {
        a = decodeArgs(bytes);
      } catch (e) {
        out({ evt: "decode_error", err: String(e) });
        return;
      }
      const s = ws.data;
      const uuid = bytesToHex(a.uuid);
      let error = "";
      if (a.uuid.length !== 16) error = "bad uuid length";
      else if (a.seq <= 0) error = "seq must be > 0";
      else if (s.uuid && s.uuid === uuid && a.seq <= s.lastSeq) error = `non-monotonic seq ${a.seq} <= ${s.lastSeq}`;
      if (!s.uuid || s.uuid !== uuid) {
        if (s.uuid) out({ evt: "uuid_change", from: s.uuid, to: uuid });
        s.uuid = uuid;
        s.lastSeq = 0;
      }
      if (!error) s.lastSeq = a.seq;
      const cancel = a.tx.length === 0;
      out({
        evt: "quote",
        uuid,
        seq: a.seq,
        block: a.blockNumber.toString(),
        cancel,
        tx_hash: cancel ? null : keccak256(bytesToHex(a.tx)),
        pairs: a.assetPairs.length,
        xregion_disabled: a.disableCrossRegionSharing,
        error,
      });
      ws.send(
        encodeResponse({
          uuid: a.uuid,
          seq: a.seq,
          timestampNs: BigInt(Date.now()) * 1_000_000n,
          error,
          bundleHash: cancel ? new Uint8Array(0) : new Uint8Array(32).fill(1),
        }),
      );
    },
  },
});
out({ evt: "listening", port });
