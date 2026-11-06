import { log } from "../log";
import { E18, parseDecimal18, scaleExpo18, type PriceSource, type PriceTick } from "./types";

function backoff(attempt: number): number {
  const base = Math.min(15_000, 500 * 2 ** Math.min(attempt, 6));
  return base / 2 + Math.random() * (base / 2);
}

/** Pyth Hermes SSE stream. Uses publish_time as observation time (a stale feed is rejected by age). */
export class PythSource implements PriceSource {
  private tick: PriceTick | null = null;
  private stopped = true;
  private ctl: AbortController | null = null;
  constructor(private baseUrl: string, private priceId: string, private maxConfBps: number, readonly name: string = "pyth") {}

  start() {
    this.stopped = false;
    void this.run();
  }
  stop() {
    this.stopped = true;
    this.ctl?.abort();
  }
  latest() {
    return this.tick;
  }

  private async run() {
    let attempt = 0;
    const id = this.priceId.replace(/^0x/, "");
    while (!this.stopped) {
      try {
        this.ctl = new AbortController();
        const url = `${this.baseUrl}/v2/updates/price/stream?ids[]=${id}&parsed=true&encoding=hex`;
        const res = await fetch(url, { signal: this.ctl.signal, headers: { accept: "text/event-stream" } });
        if (!res.ok || !res.body) throw new Error(`hermes http ${res.status}`);
        attempt = 0;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const evt = buf.slice(0, i);
            buf = buf.slice(i + 2);
            for (const line of evt.split("\n")) if (line.startsWith("data:")) this.handle(line.slice(5).trim());
          }
        }
      } catch (e) {
        if (this.stopped) return;
        log("warn", "pyth stream error", { err: e });
      }
      await Bun.sleep(backoff(attempt++));
    }
  }

  private handle(json: string) {
    try {
      const o = JSON.parse(json) as { parsed?: { id?: string; price: { price: string; conf: string; expo: number; publish_time: number } }[] };
      const e0 = o.parsed?.[0];
      const p = e0?.price;
      if (!e0 || !p) return;
      if ((e0.id ?? "").replace(/^0x/, "").toLowerCase() !== this.priceId.replace(/^0x/, "").toLowerCase()) {
        this.tick = null;
        log("error", "pyth returned unexpected feed id", { want: this.name });
        return;
      }
      if (!Number.isInteger(p.expo) || Math.abs(p.expo) > 18) {
        this.tick = null;
        return;
      }
      const int = BigInt(p.price);
      const conf = BigInt(p.conf);
      if (int <= 0n || conf < 0n) {
        this.tick = null;
        return;
      }
      // reject wide-confidence prices: conf/price in bps
      if ((conf * 10_000n * 1000n) / int > BigInt(Math.round(this.maxConfBps * 1000))) {
        this.tick = null;
        log("warn", "pyth confidence too wide; price rejected", { source: this.name });
        return;
      }
      this.tick = { price: scaleExpo18(int, p.expo), ts: p.publish_time * 1000 };
    } catch (e) {
      log("warn", "pyth parse error", { err: e });
    }
  }
}

/** Coinbase Exchange public ticker WS; mid of best bid/ask. */
export class CoinbaseSource implements PriceSource {
  readonly name = "coinbase";
  private tick: PriceTick | null = null;
  private stopped = true;
  private ws: WebSocket | null = null;
  private attempt = 0;
  constructor(private url: string, private product: string) {}

  start() {
    this.stopped = false;
    this.connect();
  }
  stop() {
    this.stopped = true;
    this.ws?.close();
  }
  latest() {
    return this.tick;
  }

  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      ws.send(JSON.stringify({ type: "subscribe", product_ids: [this.product], channels: ["ticker"] }));
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as { type?: string; best_bid?: string; best_ask?: string; price?: string };
        if (m.type !== "ticker") return;
        let price: bigint;
        if (m.best_bid && m.best_ask) price = (parseDecimal18(m.best_bid) + parseDecimal18(m.best_ask)) / 2n;
        else if (m.price) price = parseDecimal18(m.price);
        else return;
        if (price <= 0n) return;
        this.tick = { price, ts: Date.now() };
      } catch (e) {
        log("warn", "coinbase parse error", { err: e });
      }
    };
    ws.onclose = () => {
      if (this.stopped) return;
      setTimeout(() => this.connect(), backoff(this.attempt++));
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }
}

/** Local-dev random walk. Constructed only when chainId == 31337 (enforced in config + factory). */
export class DevWalkSource implements PriceSource {
  readonly name = "devwalk";
  private price: bigint;
  private tick: PriceTick | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(chainId: number, start: string, private stepBps: number) {
    if (chainId !== 31337) throw new Error("DevWalkSource only usable on chainId 31337");
    this.price = parseDecimal18(start);
  }
  start() {
    this.tick = { price: this.price, ts: Date.now() };
    this.timer = setInterval(() => {
      const r = BigInt(Math.floor((Math.random() * 2 - 1) * this.stepBps));
      this.price = (this.price * (10_000n + r)) / 10_000n;
      this.tick = { price: this.price, ts: Date.now() };
    }, 100);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  latest() {
    return this.tick;
  }
}

export { E18 };
