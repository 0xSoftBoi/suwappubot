import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bytesToHex, hexToBytes, type Address } from "viem";
import { log, metrics, originOf } from "../log";
import { decodeResponse, encodeArgs, hex } from "../titan/codec";
import type { OutgoingQuote, Transport } from "./types";

export interface TitanOpts {
  url: string;
  apiKey?: string;
  assetPairs: Uint8Array[];
  quoteAddress: Address;
  pools: Address[];
  stateDir: string;
  ackTimeoutMs: number;
  maxConsecErrors: number;
}

interface Pending {
  hash: string;
  sentAt: number;
  timer: ReturnType<typeof setTimeout>;
  onAck?: () => void;
}

/** Titan ACE maker websocket. A fresh uuid (and seq=0) is used for EVERY connection. */
export class TitanTransport implements Transport {
  readonly name = "titan-ws";
  private ws: WebSocket | null = null;
  private uuid = new Uint8Array(16);
  private seq = 0;
  private pending = new Map<number, Pending>();
  private attempt = 0;
  private openedAt = 0;
  private closing = false;
  /** latch: set by cancel(); send() refuses while latched. `finalLatch` = halt, never lifted. */
  private cancelled = false;
  private finalLatch = false;
  private stale: { uuid: Uint8Array; seq: number; block: bigint } | null = null;
  private quietThrough = 0n;
  private everSent = false;
  private consecErrors = 0;
  private lastBlock = 0n;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private o: TitanOpts) {}

  start() {
    this.connect();
  }

  connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  currentUuid() {
    return bytesToHex(this.uuid);
  }
  currentSeq() {
    return this.seq;
  }

  quietThroughBlock() {
    return this.quietThrough;
  }

  rearm() {
    if (!this.finalLatch && !this.closing) this.cancelled = false;
  }

  private connect() {
    if (this.closing) return;
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    if (this.seq > 0) {
      // old session may still have live quotes at Titan: remember it so we can cancel it over the new socket, and
      // do not sign again for the rest of the block we last quoted (M4)
      this.stale = { uuid: this.uuid, seq: this.seq, block: this.lastBlock };
      this.quietThrough = this.lastBlock > this.quietThrough ? this.lastBlock : this.quietThrough;
    }
    this.uuid = randomBytes(16);
    this.seq = 0;
    this.consecErrors = 0;
    const headers: Record<string, string> = {};
    if (this.o.apiKey) headers["Authorization"] = this.o.apiKey;
    const ws = new WebSocket(this.o.url, { headers } as any);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.openedAt = Date.now();
      log("info", "titan connected", { url: originOf(this.o.url), uuid: this.currentUuid() });
      if (this.stale) {
        const st = this.stale;
        this.stale = null;
        this.sendRaw(st.uuid, st.seq + 1, new Uint8Array(0), st.block);
        log("warn", "sent CANCEL for previous-session uuid (Titan per-connection scoping UNVERIFIED)", { old_uuid: bytesToHex(st.uuid) });
      }
      try {
        mkdirSync(this.o.stateDir, { recursive: true });
        writeFileSync(join(this.o.stateDir, "titan-session.json"), JSON.stringify({ uuid: this.currentUuid(), startedAt: new Date().toISOString() }));
      } catch (e) {
        log("warn", "cannot persist titan session", { err: e });
      }
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closing) return;
      const lived = this.openedAt ? Date.now() - this.openedAt : 0;
      this.attempt = lived > 5000 ? 0 : this.attempt + 1;
      this.openedAt = 0;
      metrics.reconnects++;
      const base = Math.min(15_000, 250 * 2 ** Math.min(this.attempt, 7));
      const delay = base / 2 + Math.random() * (base / 2);
      log("warn", "titan disconnected; reconnecting with new uuid", { in_ms: Math.round(delay), old_uuid: bytesToHex(this.uuid) });
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private onMessage(data: unknown) {
    let r;
    try {
      const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
      if (!buf) throw new Error("non-binary frame");
      r = decodeResponse(buf);
    } catch (e) {
      metrics.errors++;
      log("warn", "titan decode error", { err: e });
      return;
    }
    if (hex(r.uuid) !== this.currentUuid()) {
      log("debug", "ack for foreign uuid ignored", { uuid: hex(r.uuid), seq: r.seq });
      return;
    }
    const p = this.pending.get(r.seq);
    if (!p) {
      log("debug", "ack with no pending match", { seq: r.seq });
      return;
    }
    clearTimeout(p.timer);
    this.pending.delete(r.seq);
    if (r.error) {
      metrics.errors++;
      this.onError(`titan error seq=${r.seq}: ${r.error}`);
    } else {
      metrics.acks++;
      this.consecErrors = 0;
      log("debug", "titan ack", { seq: r.seq, rtt_ms: Date.now() - p.sentAt, bundle: hex(r.bundleHash), tx: p.hash });
    }
    p.onAck?.();
  }

  private onError(msg: string) {
    this.consecErrors++;
    log("warn", msg, { consec: this.consecErrors });
    if (this.consecErrors >= this.o.maxConsecErrors) {
      this.consecErrors = 0;
      void this.cancel(`${this.o.maxConsecErrors} consecutive errors`, this.lastBlock).then(() => {
        setTimeout(() => this.rearm(), 2000); // soft latch: auto-lift after cooldown (never lifts a halt)
      });
    }
  }

  private sendRaw(uuid: Uint8Array, seq: number, tx: Uint8Array, blockNumber: bigint): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(
      encodeArgs({ tx, blockNumber, uuid, seq, assetPairs: this.o.assetPairs, quoteAddress: this.o.quoteAddress, poolAddresses: this.o.pools }),
    );
    return true;
  }

  private transmit(tx: Uint8Array, blockNumber: bigint, hash: string, onAck?: () => void): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const seq = this.seq + 1;
    if (!this.sendRaw(this.uuid, seq, tx, blockNumber)) return false;
    this.seq = seq;
    const timer = setTimeout(() => {
      if (this.pending.delete(seq)) {
        metrics.errors++;
        this.onError(`titan ack timeout seq=${seq}`);
      }
    }, this.o.ackTimeoutMs);
    this.pending.set(seq, { hash, sentAt: Date.now(), timer, onAck });
    return true;
  }

  async send(q: OutgoingQuote): Promise<boolean> {
    if (this.closing || this.cancelled) return false; // latch: nothing may be sent after a cancel
    if (q.blockNumber <= this.quietThrough) return false;
    this.lastBlock = q.blockNumber;
    this.everSent = true;
    return this.transmit(hexToBytes(q.raw), q.blockNumber, q.hash);
  }

  async cancel(reason: string, blockNumber: bigint | null, opts: { final?: boolean } = {}): Promise<void> {
    this.cancelled = true; // set BEFORE anything else so a concurrent send() is refused
    if (opts.final) this.finalLatch = true;
    if (blockNumber !== null && this.everSent) this.lastBlock = blockNumber;
    metrics.cancels++;
    log("warn", "titan CANCEL", { reason, uuid: this.currentUuid(), next_seq: this.seq + 1 });
    await new Promise<void>((resolve) => {
      const sent = this.transmit(new Uint8Array(0), this.lastBlock, "cancel", resolve);
      if (!sent) {
        // socket down: the old session is remembered (this.stale on reconnect) and its cancel goes out first on open
        if (this.seq > 0 && !this.stale) this.stale = { uuid: this.uuid, seq: this.seq, block: this.lastBlock };
        return resolve();
      }
      setTimeout(resolve, 500); // do not hang shutdown on a missing ack
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.cancelled = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.ws?.close();
  }
}
