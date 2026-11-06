import type { PublicClient } from "viem";
import { TESTNET_CHAIN_IDS } from "../config";
import { log, metrics } from "../log";
import type { OutgoingQuote, Transport } from "./types";

/** Direct eth_sendRawTransaction. For local anvil / testnets / dev only (no ordering guarantee). */
export class RpcTransport implements Transport {
  readonly name = "rpc";
  constructor(private client: PublicClient, chainId: number) {
    if (!(TESTNET_CHAIN_IDS as readonly number[]).includes(chainId)) throw new Error(`rpc transport refused: chainId ${chainId} is not a testnet/local chain`);
  }

  async send(q: OutgoingQuote): Promise<boolean> {
    try {
      const h = await this.client.sendRawTransaction({ serializedTransaction: q.raw });
      metrics.acks++;
      log("info", "rpc push accepted", { tx: h, block_target: q.blockNumber });
      return true;
    } catch (e) {
      metrics.errors++;
      log("warn", "rpc send failed", { tx: q.hash, err: e });
      return false;
    }
  }

  async cancel(reason: string): Promise<void> {
    // Nothing can be withdrawn from a public mempool; the loop simply stops signing.
    log("warn", "rpc transport: cancel is a no-op (stop signing)", { reason });
  }

  connected() {
    return true;
  }
  async close() {}
}
