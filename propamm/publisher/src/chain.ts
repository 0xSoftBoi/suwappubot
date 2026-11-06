import { createPublicClient, http, webSocket, type Address, type Block, type PublicClient } from "viem";
import type { Config } from "./config";
import { log } from "./log";
import { maxFeeFor, oracleAbi, projectBaseFee } from "./tx";

export interface HeadState {
  number: bigint;
  hash: `0x${string}`;
  /** oracle price at END of head == START of head+1 (the bound's reference for the target block) */
  refPrice: bigint;
  oracleBlock: bigint;
  nonce: number;
  maxFeePerGas: bigint;
  receivedAt: number;
  /** gas limit cache for this head (filled lazily by the loop) */
  gas?: bigint;
}

/** Tracks the chain head (WS newHeads), the oracle's start-of-next-block reference, pending nonce and fees. */
export class Chain {
  readonly http: PublicClient;
  private ws: PublicClient;
  head: HeadState | null = null;
  maxStepBps = 0;
  private maxStepAt = 0;
  private seq = 0;
  private unwatch: (() => void) | null = null;
  /** ms epoch until which we do not quote (set after a reorg is observed) */
  quietUntil = 0;
  loading = false;

  constructor(private cfg: Config, private pusher: Address) {
    this.http = createPublicClient({ transport: http(cfg.RPC_HTTP_URL) }) as PublicClient;
    this.ws = createPublicClient({ transport: webSocket(cfg.RPC_WS_URL, { reconnect: true, keepAlive: { interval: 10_000 } }) }) as PublicClient;
  }

  async init() {
    const id = await this.http.getChainId();
    if (id !== this.cfg.CHAIN_ID) throw new Error(`chainId mismatch: rpc=${id} cfg=${this.cfg.CHAIN_ID}`);
    const code = await this.http.getCode({ address: this.cfg.ORACLE_ADDRESS });
    if (!code || code === "0x") throw new Error("no contract code at ORACLE_ADDRESS");
    const ok = (await this.http.readContract({ address: this.cfg.ORACLE_ADDRESS, abi: oracleAbi, functionName: "isPusher", args: [this.pusher] })) as boolean;
    if (!ok) throw new Error(`signer ${this.pusher} is not whitelisted as oracle pusher (refusing to start)`);
    const ps = (await this.http.readContract({ address: this.cfg.ORACLE_ADDRESS, abi: oracleAbi, functionName: "maxStepBps" })) as number;
    if (!ps) throw new Error("oracle maxStepBps is 0");
    const blk = await this.http.getBlock();
    await this.onBlock(blk);
    this.unwatch = this.ws.watchBlocks({
      onBlock: (b) => void this.onBlock(b as Block),
      onError: (e) => log("warn", "newHeads error", { err: e }),
      includeTransactions: false,
    });
    // catch-up poll: covers a WS subscription that was not yet live (or dropped) when a block landed
    this.poller = setInterval(() => {
      this.http
        .getBlock()
        .then((b) => {
          if (!this.head ? !this.loading : b.number !== null && b.number > this.head.number) return this.onBlock(b);
        })
        .catch((e) => log("warn", "head poll failed", { err: e }));
    }, 500);
  }

  private poller: ReturnType<typeof setInterval> | null = null;

  stop() {
    if (this.poller) clearInterval(this.poller);
    this.unwatch?.();
  }

  targetBlock(): bigint | null {
    return this.head ? this.head.number + 1n : null;
  }

  private async onBlock(b: Block) {
    if (b.number === null || b.hash === null) return;
    const prev = this.head;
    if (prev && (b.number <= prev.number || (b.number === prev.number + 1n && b.parentHash !== prev.hash)) && b.hash !== prev.hash) {
      this.quietUntil = Date.now() + 1000;
      log("warn", "reorg or non-contiguous head", { prev: prev.number, next: b.number });
    }
    const my = ++this.seq;
    this.loading = true;
    try {
      const now = Date.now();
      const stepStale = now - this.maxStepAt > 30_000;
      const [pr, nonce, step] = await Promise.all([
        this.http.readContract({ address: this.cfg.ORACLE_ADDRESS, abi: oracleAbi, functionName: "getPrice", args: [this.cfg.FEED_ID], blockNumber: b.number }),
        this.http.getTransactionCount({ address: this.pusher, blockTag: "pending" }),
        stepStale ? this.http.readContract({ address: this.cfg.ORACLE_ADDRESS, abi: oracleAbi, functionName: "maxStepBps" }) : Promise.resolve(this.maxStepBps),
      ]);
      if (my !== this.seq) return; // a newer head superseded this load
      const [price, oracleBlock] = pr as readonly [bigint, bigint, bigint];
      if (stepStale) {
        this.maxStepBps = Number(step);
        this.maxStepAt = now;
      }
      const base = b.baseFeePerGas;
      if (base === null || base === undefined) throw new Error("chain has no EIP-1559 base fee");
      this.head = {
        number: b.number,
        hash: b.hash,
        refPrice: price,
        oracleBlock,
        nonce,
        maxFeePerGas: maxFeeFor(projectBaseFee({ baseFeePerGas: base, gasUsed: b.gasUsed, gasLimit: b.gasLimit })),
        receivedAt: now,
      };
    } catch (e) {
      if (my === this.seq) {
        this.head = null; // fail closed: no quoting on unknown state
        log("error", "head refresh failed", { err: e, block: b.number });
      }
    } finally {
      if (my === this.seq) this.loading = false;
    }
  }

  /** Re-read the pending nonce (after a send in rpc mode). */
  async refreshNonce() {
    if (!this.head) return;
    const n = await this.http.getTransactionCount({ address: this.pusher, blockTag: "pending" });
    if (this.head) this.head.nonce = n;
  }
}
