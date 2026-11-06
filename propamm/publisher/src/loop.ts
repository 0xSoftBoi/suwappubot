import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address } from "viem";
import type { Aggregator } from "./prices/aggregator";
import type { Chain } from "./chain";
import type { Config } from "./config";
import { log, metrics } from "./log";
import { decideQuote, type QuoteParams } from "./quote";
import type { Signer } from "./signer/types";
import type { Transport } from "./transport/types";
import { encodePush, signPush, type TxPolicy, type UnsignedPush } from "./tx";

const SIGN_TIMEOUT_MS = 3000;
const MAX_CONSEC_SIGN_ERRORS = 5;

export class Publisher {
  halted = false;
  haltReason = "";
  pricesHealthy = false;
  lastFair: bigint | null = null;
  private running = false;
  private wasUnhealthy = false;
  private healthyStreak = 0;
  private consecSignErrors = 0;
  private last: { block: bigint; price: bigint; at: number } | null = null;
  private qp: QuoteParams;
  private policy: TxPolicy;
  private pusher: Address;

  constructor(
    private cfg: Config,
    private chain: Chain,
    private agg: Aggregator,
    private signer: Signer,
    private transport: Transport,
  ) {
    this.pusher = signer.address;
    this.qp = {
      stepSafetyBps: cfg.STEP_SAFETY_BPS,
      minMoveBps: cfg.MIN_MOVE_BPS,
      heartbeatMs: cfg.HEARTBEAT_MS,
      requoteEveryBlock: cfg.REQUOTE_EVERY_BLOCK,
      maxAnchorDevBps: cfg.MAX_ANCHOR_DEV_BPS,
      anchorSafetyBps: cfg.ANCHOR_SAFETY_BPS,
    };
    this.policy = {
      chainId: cfg.CHAIN_ID,
      oracle: cfg.ORACLE_ADDRESS,
      feedId: cfg.FEED_ID,
      maxGas: BigInt(cfg.GAS_LIMIT_CAP),
      maxFeeCapWei: BigInt(Math.round(cfg.MAX_FEE_GWEI_CAP * 1e9)),
    };
  }

  private cur: Promise<void> = Promise.resolve();

  /** Latch: stop signing, cancel everything. Persisted via KILL_SWITCH_FILE unless persist=false (graceful shutdown).
   *  `halted` is set synchronously FIRST, and the transport latches on cancel, so an in-flight tick cannot send afterwards. */
  async halt(reason: string, opts: { persist?: boolean } = {}): Promise<void> {
    if (this.halted) return;
    this.halted = true;
    this.haltReason = reason;
    log("error", "HALT", { reason });
    if (opts.persist !== false) {
      try {
        mkdirSync(dirname(this.cfg.KILL_SWITCH_FILE), { recursive: true });
        writeFileSync(this.cfg.KILL_SWITCH_FILE, `halted ${new Date().toISOString()}: ${reason}\n`);
      } catch (e) {
        log("error", "could not persist kill-switch file", { err: e });
      }
    }
    await this.transport.cancel(reason, this.chain.targetBlock(), { final: true }).catch((e) => log("error", "cancel failed", { err: e }));
  }

  /** Wait (bounded) for the in-flight tick to finish. */
  async drain(): Promise<void> {
    await Promise.race([this.cur.catch(() => {}), Bun.sleep(SIGN_TIMEOUT_MS + 1000)]);
  }

  async run() {
    this.running = true;
    while (this.running) {
      const t0 = Date.now();
      this.cur = this.tick(t0);
      try {
        await this.cur;
      } catch (e) {
        metrics.errors++;
        log("error", "tick error", { err: e });
      }
      await Bun.sleep(Math.max(1, this.cfg.UPDATE_INTERVAL_MS - (Date.now() - t0)));
    }
  }

  stop() {
    this.running = false;
  }

  private async tick(now: number) {
    if (this.halted) return;
    if (existsSync(this.cfg.KILL_SWITCH_FILE)) return this.halt("kill-switch file present");

    const head = this.chain.head;
    if (!head || this.chain.loading || now < this.chain.quietUntil) {
      metrics.skips++;
      return;
    }
    const target = head.number + 1n;

    const a = this.agg.read(now);
    if (!a.ok) {
      this.pricesHealthy = false;
      metrics.unhealthy_ticks++;
      this.healthyStreak = 0;
      if (!this.wasUnhealthy) {
        this.wasUnhealthy = true;
        log("error", "prices unhealthy; cancelling", { reason: a.reason });
        await this.transport.cancel(`unhealthy prices: ${a.reason}`, target);
        this.last = null;
      }
      return;
    }
    this.lastFair = a.price;
    if (this.wasUnhealthy) {
      if (++this.healthyStreak < this.cfg.RECOVERY_TICKS) return;
      this.wasUnhealthy = false;
      log("info", "prices healthy again", {});
      this.transport.rearm?.();
    }
    this.pricesHealthy = true;

    if (this.transport.name === "rpc" && this.last?.block === target) {
      metrics.skips++; // rpc mode: at most one tx per target block (shared nonce, no replacement semantics)
      return;
    }

    if (this.transport.quietThroughBlock && target <= this.transport.quietThroughBlock()) {
      metrics.skips++; // reconnected mid-block: do not sign again for the rest of that block
      return;
    }

    const d = decideQuote(this.qp, {
      fair: a.price,
      ref: head.refPrice,
      maxStepBps: this.chain.maxStepBps,
      targetBlock: target,
      now,
      last: this.last,
    });
    if (d.action === "halt") return this.halt(d.reason);
    if (d.action === "skip") {
      metrics.skips++;
      return;
    }

    // ---- sign (strictly one in flight: this loop awaits it) ----
    try {
      const data = encodePush(this.cfg.FEED_ID, d.price, target);
      if (head.gas === undefined) {
        const est = await this.chain.http.estimateGas({ account: this.pusher, to: this.cfg.ORACLE_ADDRESS, data });
        const g = (est * 12n) / 10n;
        head.gas = g > this.policy.maxGas ? this.policy.maxGas : g;
      }
      const tx: UnsignedPush = {
        to: this.cfg.ORACLE_ADDRESS,
        data,
        value: 0n,
        chainId: this.cfg.CHAIN_ID,
        nonce: head.nonce, // shared across replacements; advances only when one lands
        gas: head.gas,
        maxFeePerGas: head.maxFeePerGas,
        maxPriorityFeePerGas: 0n,
        targetBlock: target,
      };
      if (this.cfg.DEV_SIGN_DELAY_MS > 0 && this.cfg.CHAIN_ID === 31337) await Bun.sleep(this.cfg.DEV_SIGN_DELAY_MS); // test hook
      const signed = await Promise.race([
        signPush(this.signer, tx, this.policy),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("sign timeout")), SIGN_TIMEOUT_MS)),
      ]);
      this.consecSignErrors = 0;
      // re-check immediately before send: halted/stopping, or the head moved (candidate is only valid in `target`)
      if (this.halted || !this.running) {
        log("warn", "dropping signed candidate: halted/stopping", { tx: signed.hash });
        return;
      }
      if (this.chain.head?.number !== head.number) {
        metrics.skips++;
        return;
      }
      const ok = await this.transport.send({ raw: signed.raw, hash: signed.hash, blockNumber: target });
      if (ok) {
        metrics.pushes++;
        this.last = { block: target, price: d.price, at: now };
        log("info", "push", {
          tx: signed.hash,
          block_target: target,
          price: d.price,
          fair: a.price,
          clamped: d.clamped,
          nonce: head.nonce,
          sources: a.used.join("+"),
        });
        if (this.transport.name === "rpc") await this.chain.refreshNonce().catch(() => {});
      } else {
        metrics.skips++;
      }
    } catch (e) {
      metrics.sign_errors++;
      log("error", "push failed", { err: e });
      if (++this.consecSignErrors >= MAX_CONSEC_SIGN_ERRORS) await this.halt(`${MAX_CONSEC_SIGN_ERRORS} consecutive sign/build errors`);
    }
  }
}
